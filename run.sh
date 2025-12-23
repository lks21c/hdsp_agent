#!/bin/bash
# HDSP Agent - Unified Run Script
# Runs JupyterLab with embedded Agent Server in a single process
#
# Configuration: ~/.jupyter/hdsp_agent_config.json
#   {
#     "embed_agent_server": true,  // Enable embedded mode
#     "agent_server_port": 8000,   // Agent server port
#     ...
#   }

set -e

# Change to script directory
cd "$(dirname "$0")"
ROOT_DIR=$(pwd)

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== HDSP Agent ===${NC}"
echo ""

# Parse arguments
BUILD=false
JUPYTER_PORT=8888
EMBED_MODE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --build)
            BUILD=true
            shift
            ;;
        --port)
            JUPYTER_PORT="$2"
            shift 2
            ;;
        --embed)
            EMBED_MODE="1"
            shift
            ;;
        --no-embed)
            EMBED_MODE="0"
            shift
            ;;
        --help|-h)
            echo "Usage: ./run.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --build         Run build.sh before starting"
            echo "  --port PORT     JupyterLab port (default: 8888)"
            echo "  --embed         Force embedded mode (override config)"
            echo "  --no-embed      Force proxy mode (override config)"
            echo "  --help, -h      Show this help message"
            echo ""
            echo "Configuration: ~/.jupyter/hdsp_agent_config.json"
            echo "  embed_agent_server: true/false  (default: false)"
            echo "  agent_server_port: 8000         (for embedded mode)"
            echo "  agent_server_url: http://...    (for proxy mode)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check for existing processes on JupyterLab port
check_port() {
    local port=$1
    local name=$2
    if lsof -i :$port >/dev/null 2>&1; then
        echo -e "${YELLOW}Warning: Port $port ($name) is already in use${NC}"
        echo "Processes on port $port:"
        lsof -i :$port | head -5
        echo ""
        read -p "Kill existing process? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            lsof -ti :$port | xargs -r kill -9 2>/dev/null || true
            sleep 1
        else
            exit 1
        fi
    fi
}

check_port $JUPYTER_PORT "JupyterLab"

# Run build if requested
if [ "$BUILD" = true ]; then
    echo -e "${YELLOW}Running build...${NC}"
    ./build.sh
    echo ""
fi

# Check if labextension is built
if [ ! -d "$ROOT_DIR/extensions/jupyter/jupyter_ext/labextension" ]; then
    echo -e "${YELLOW}Lab extension not built. Running build...${NC}"
    ./build.sh
    echo ""
fi

# Set embed mode if explicitly requested via command line
if [ -n "$EMBED_MODE" ]; then
    export HDSP_EMBED_AGENT_SERVER=$EMBED_MODE
fi

# Show mode info
CONFIG_FILE="$HOME/.jupyter/hdsp_agent_config.json"
if [ -f "$CONFIG_FILE" ]; then
    EMBED_CONFIG=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('embed_agent_server', False))" 2>/dev/null || echo "false")
else
    EMBED_CONFIG="false"
fi

if [ "$EMBED_MODE" = "1" ] || [ "$EMBED_CONFIG" = "True" ] || [ "$EMBED_CONFIG" = "true" ]; then
    echo -e "${GREEN}Starting HDSP Agent (Embedded Mode)${NC}"
    echo "  Mode:          Embedded (single process)"
else
    echo -e "${GREEN}Starting HDSP Agent (Proxy Mode)${NC}"
    echo "  Mode:          Proxy (separate agent server required)"
fi
echo "  JupyterLab:    http://localhost:$JUPYTER_PORT"
echo "  Config:        $CONFIG_FILE"
echo ""

# Run JupyterLab
exec poetry run jupyter lab \
    --port=$JUPYTER_PORT \
    --no-browser \
    --ServerApp.token='' \
    --ServerApp.password='' \
    --ServerApp.allow_origin='*' \
    --ServerApp.disable_check_xsrf=True
