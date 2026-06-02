import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Provide placeholder secrets so service modules that eagerly instantiate
# their SDK clients at import time (OpenAI, Supabase, etc.) don't crash
# during test collection. Real values are only needed for integration tests
# that hit those services — unit tests mock the clients.
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ASSEMBLYAI_API_KEY", "test-assemblyai-key")
os.environ.setdefault("DEEPGRAM_KEY", "test-deepgram-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SECRET_KEY", "sb_secret_test_placeholder")
