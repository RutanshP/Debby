from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

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


@patch.object(insights.client.chat.completions, "create", new_callable=AsyncMock)
@patch.object(insights, "get_profile", new_callable=AsyncMock)
@patch.object(insights, "list_rounds", new_callable=AsyncMock)
async def test_refresh_insights_uses_display_name_in_summary(
    list_rounds_mock: AsyncMock,
    get_profile_mock: AsyncMock,
    create_mock: AsyncMock,
):
    list_rounds_mock.return_value = [
        SimpleNamespace(
            topic="Aff topic",
            side="aff",
            aff_speech="student aff constructive",
            aff_two_speech="student aff rebuttal",
            neg_speech="debby neg speech",
            speech_metrics={},
        )
    ]
    get_profile_mock.return_value = {"user_id": "u1", "display_name": "Rutansh"}
    create_mock.return_value = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=(
                        '{"headline":"Pradhanj shows potential but needs clearer signposting.",'
                        '"strengths":["Strong examples","Clear passion","Good energy"],'
                        '"recurring_issues":["Needs better signposting","Filler words show up","Warrants need depth"],'
                        '"suggested_focus":"Practice cleaner roadmaps."}'
                    )
                )
            )
        ]
    )

    with patch.object(insights, "_upsert", new_callable=AsyncMock) as upsert_mock:
        upsert_mock.return_value = SimpleNamespace()
        await insights.refresh_insights("u1")

    user_message = create_mock.await_args.kwargs["messages"][1]["content"]
    assert "display name is Rutansh" in user_message
    saved_summary = upsert_mock.await_args.args[1]
    assert saved_summary.headline.startswith("Rutansh shows potential")
