from __future__ import annotations

MAX_TOPIC_WORDS = 100


def count_topic_words(topic: str) -> int:
    return len(topic.split())


def validate_topic_word_limit(topic: str) -> str:
    topic = topic.strip()
    if not topic:
        raise ValueError("Topic is required.")
    if count_topic_words(topic) > MAX_TOPIC_WORDS:
        raise ValueError(f"Topic must be {MAX_TOPIC_WORDS} words or fewer.")
    return topic
