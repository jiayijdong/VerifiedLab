#!/bin/bash
# Launch the VerifiedLab live-demo model servers inside the current Slurm allocation.
# Usage: bash slurm/launch_servers.sh            (uses $SLURM_JOB_ID / $SLURM_NODELIST)
#        bash slurm/launch_servers.sh --no-70b   (keep an already-running 70B server; relaunch only the Qwen servers)
# Each server is one `srun --overlap` step pinned to a node and a GPU set; logs in logs/, endpoints in slurm/endpoints.json.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${VL_ENV:+$VL_ENV/bin/}python"
JOB="${VL_JOBID:-${SLURM_JOB_ID:?no Slurm allocation}}"
mapfile -t NODES < <(scontrol show hostnames "$(squeue -j "$JOB" -h -o %N)")
[ "${#NODES[@]}" -ge 4 ] || { echo "need 4 nodes, got ${NODES[*]}"; exit 1; }
WANT70=1; [ "${1:-}" = "--no-70b" ] && WANT70=0
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 VLLM_LOGGING_LEVEL=WARNING
mkdir -p "$ROOT/logs"

launch() { # node gpus port name model extra...
  local node=$1 gpus=$2 port=$3 name=$4 model=$5; shift 5
  local ntp; ntp=$(echo "$gpus" | tr ',' '\n' | wc -l)
  echo "[$node gpu $gpus :$port] $name <- $model $*"
  echo "{\"name\":\"$name\",\"model\":\"$model\",\"node\":\"$node\",\"gpus\":\"$gpus\",\"url\":\"http://$node:$port/v1\"}" >> "$ROOT/slurm/endpoints.jsonl"
  [ "${SKIP:-0}" = 1 ] && { echo "  (not launched; endpoint recorded)"; return; }
  # Slurm resets CUDA_VISIBLE_DEVICES when the step starts, so the pin must happen inside the step.
  setsid nohup srun --jobid="$JOB" --overlap --input=none -N1 -n1 -w "$node" --gpus-per-node=4 --cpus-per-task=16 \
    bash -c "export CUDA_VISIBLE_DEVICES=$gpus; exec '$PY' -m vllm.entrypoints.openai.api_server --model '$model' --served-model-name '$name' --port $port --host 0.0.0.0 --tensor-parallel-size $ntp --dtype bfloat16 --trust-remote-code $*" \
    < /dev/null > "$ROOT/logs/$name.log" 2>&1 &
  sleep "${VL_LAUNCH_GAP:-4}"     # the step manager can deadlock when many steps are created at the same instant
}

: > "$ROOT/slurm/endpoints.jsonl"
N0=${NODES[0]} N1=${NODES[1]} N2=${NODES[2]} N3=${NODES[3]}
# node 0 + node 1: two frontier open-weight replicas (fp8 weight-only so a 70B fits on 4x40GB): PI/critic and generator/critic
SKIP=$((1-WANT70)) launch $N0 0,1,2,3 8001 llama-3.3-70b   meta-llama/Llama-3.3-70B-Instruct --quantization fp8 --max-model-len 8192 --gpu-memory-utilization 0.92 --max-num-seqs 16
SKIP=$((1-WANT70)) launch $N1 0,1,2,3 8012 llama-3.3-70b-b meta-llama/Llama-3.3-70B-Instruct --quantization fp8 --max-model-len 8192 --gpu-memory-utilization 0.92 --max-num-seqs 16
# node 2: two Qwen3-14B replicas: verifier A and the specialist team (device physicist / materials chemist / data scientist in parallel)
launch $N2 0,1 8002 qwen3-14b   Qwen/Qwen3-14B --max-model-len 16384 --gpu-memory-utilization 0.90
launch $N2 2,3 8003 qwen3-14b-b Qwen/Qwen3-14B --max-model-len 16384 --gpu-memory-utilization 0.90
# node 3: verifier B pool, four Qwen3-4B replicas (one per GPU) for parallel field-wise audits
p=8004
for g in 0 1 2 3; do launch $N3 $g $p "qwen3-4b-r$((p-8003))" Qwen/Qwen3-4B --max-model-len 8192 --gpu-memory-utilization 0.90; p=$((p+1)); done
"$PY" - "$ROOT/slurm/endpoints.jsonl" "$ROOT/slurm/endpoints.json" <<'PYEOF'
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
json.dump({"servers":rows},open(sys.argv[2],"w"),indent=2)
print(f"wrote {sys.argv[2]} with {len(rows)} servers")
PYEOF
echo "Follow with: bash slurm/wait_servers.sh"
# VL_WAIT=1 keeps this script alive as the parent of the server steps (needed on step-manager allocations, where orphaned srun steps can hang before step creation).
[ "${VL_WAIT:-0}" = 1 ] && { echo "VL_WAIT=1: staying alive as the parent of the server steps"; wait; }
