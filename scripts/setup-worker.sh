#!/bin/bash
# KCKills Worker Setup Script
# Run this once to set up the worker environment

set -e

echo "=== KCKills Worker Setup ==="

# Check Python
if ! command -v python &> /dev/null; then
    echo "ERROR: Python is not installed."
    exit 1
fi

echo "Python: $(python --version)"

# Check ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "WARNING: ffmpeg is not installed. Install it:"
    echo "  Windows: winget install ffmpeg"
    echo "  Mac: brew install ffmpeg"
    echo "  Linux: sudo apt install ffmpeg"
fi

# Check yt-dlp
if ! command -v yt-dlp &> /dev/null; then
    echo "Installing yt-dlp..."
    pip install yt-dlp
fi

# Install Python dependencies
echo "Installing Python dependencies..."
cd worker
pip install -r requirements.txt

# Create directories
mkdir -p clips thumbnails

# Check .env
if [ ! -f .env ]; then
    echo ""
    echo "IMPORTANT: Copy .env.example to .env and fill in your credentials:"
    echo "  cp .env.example .env"
    echo ""
    echo "You need:"
    echo "  1. Supabase project URL + service role key"
    echo "  2. Cloudflare R2 credentials"
    echo "  3. (Optional) YouTube API key"
    echo "  4. (Optional) Discord webhook URL"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "To run the worker:"
echo "  cd worker"
echo "  python -m src.main          # Run daemon (24/7)"
echo "  python -m src.main once     # Run all modules once"
echo "  python -m src.main sentinel # Run sentinel only"
