#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Building GroveSimulatorServer..."
swift build -c release

echo "Built: .build/release/GroveSimulatorServer"
