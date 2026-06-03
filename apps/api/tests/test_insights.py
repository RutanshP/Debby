from types import SimpleNamespace

from services import insights


def test_build_corpus_uses_only_student_speeches_for_each_side():
    rounds = [
        SimpleNamespace(
            topic="Aff topic",
            side="aff",
            aff_speech="student aff constructive",
            aff_two_speech="student aff rebuttal",
            neg_speech="debby neg speech",
            speech_metrics={
                "aff": {"filler_count": 1, "filler_per_minute": 2.0, "major_pause_count": 0},
                "aff_two": {"filler_count": 2, "filler_per_minute": 3.0, "major_pause_count": 1},
                "neg": {"filler_count": 99, "filler_per_minute": 99.0, "major_pause_count": 99},
            },
        ),
        SimpleNamespace(
            topic="Neg topic",
            side="neg",
            aff_speech="debby aff constructive",
            aff_two_speech="debby aff rebuttal",
            neg_speech="student neg speech",
            speech_metrics={
                "aff": {"filler_count": 88, "filler_per_minute": 88.0, "major_pause_count": 88},
                "aff_two": {"filler_count": 77, "filler_per_minute": 77.0, "major_pause_count": 77},
                "neg": {"filler_count": 4, "filler_per_minute": 5.0, "major_pause_count": 2},
            },
        ),
    ]

    corpus, used = insights._build_corpus(rounds)

    assert used == 2
    assert "student aff constructive" in corpus
    assert "student aff rebuttal" in corpus
    assert "student neg speech" in corpus
    assert "debby neg speech" not in corpus
    assert "debby aff constructive" not in corpus
    assert "debby aff rebuttal" not in corpus
    assert "aff: 1 fillers" in corpus
    assert "aff_two: 2 fillers" in corpus
    assert "neg: 4 fillers" in corpus
    assert "neg: 99 fillers" not in corpus
    assert "aff: 88 fillers" not in corpus
