#!/bin/bash
# Stop every vLLM step started by launch_servers.sh (same Slurm job).
pkill -u "$USER" -f "vllm.entrypoints.openai.api_server" ; sleep 2; pgrep -u "$USER" -fa "vllm.entrypoints" || echo "all model servers stopped"
