#!/usr/bin/env python3
"""Run the Recall MCP server (stdio) from a checkout or installed skill."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from usual.mcp_server import main

if __name__ == "__main__":
    raise SystemExit(main())
