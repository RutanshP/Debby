# Debby

> Debby now runs on **FastAPI (`apps/api/`)** and **Next.js (`apps/web/`)** with Supabase auth/DB. The old Flask + vanilla JS app has been removed from `main`; use the `legacy-flask` tag if you need to inspect the former implementation.

Debby is a full-stack web application for independent debate practice. It lets students generate debate topics, record speeches, receive an AI opponent response, deliver a rebuttal, and review a judge-style reason for decision with speech statistics, flow sheets, and personalized drill feedback.

The app currently supports MSPDP and Parliamentary debate practice, including tournament-based Parliamentary topic selection, speed-reading drills, case generation, round history, and delivery analytics.

## Features

- **Practice rounds**: Generate or enter a topic, record an affirmative speech, receive Debby's response, record a rebuttal, and get a winner with an RFD.
- **Speech transcription**: Uses AssemblyAI to transcribe recorded browser audio.
- **AI debate response and judging**: Uses OpenAI to generate opposing speeches, drill feedback, debate flows, and judge decisions.
- **Speech analytics**: Calculates WPM, word counts, speech duration, average WPM, and WPM over time.
- **Debate drills**: Includes rebuttal, speed reading, impact extension, and contention brainstorming drills.
- **Case Builder**: Generates formatted MSPDP or Parliamentary cases for either side of a topic.
- **Round history**: Saves past rounds, transcripts, decisions, statistics, and generated flows.
- **Deployment-ready**: Uses a FastAPI backend, Next.js frontend, Supabase auth/database, and Vercel/Railway deployment configuration.

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: FastAPI, Python, Pydantic
- **Auth and database**: Supabase Auth and Supabase Postgres
- **AI APIs**: OpenAI, AssemblyAI
- **Audio and speech analytics**: Browser MediaRecorder, AssemblyAI word timestamps, custom WPM and accuracy scoring
- **Charts and UI**: Recharts, React components
- **Deployment**: Vercel for `apps/web`, Railway for `apps/api`
- **Testing**: Jest, React Testing Library, pytest, respx

## Project Structure

```text
Debby/
|-- apps/
|   |-- api/
|   |   |-- main.py          # FastAPI application entry point
|   |   |-- routes/          # API routes for rounds, drills, topics, AI, auth
|   |   |-- services/        # OpenAI, AssemblyAI, Supabase, topic, and scoring logic
|   |   |-- models/          # Pydantic request/response models
|   |   |-- migrations/      # Supabase schema and seed migrations
|   |   |-- data/            # Parliamentary, MSPDP, and speed-reading source data
|   |   `-- tests/           # pytest backend tests
|   `-- web/
|       |-- app/             # Next.js app routes
|       |-- components/      # Shared React UI components
|       |-- hooks/           # Browser recording and app hooks
|       |-- lib/             # API and Supabase client helpers
|       `-- __tests__/       # Jest/React Testing Library tests
|-- DEPLOY.md                # Supabase, Railway, and Vercel deployment guide
|-- vercel.json              # Frontend deployment config
`-- railway.toml             # Backend deployment config
```

## Main Routes

| Route | Purpose |
| --- | --- |
| `/` | Main debate practice page |
| `/drills` | Debate drill workspace |
| `/parli-gpt` | Case Builder |
| `/history` | Saved round history |
| `/history/[roundId]` | Detailed round view with RFD, flow, transcripts, and WPM charts |
| `/api/topics` | Generate debate topics |
| `/api/topics/tournaments` | List Parliamentary tournament filters |
| `/api/rounds` | Create and list saved rounds |
| `/api/rounds/{round_id}/speeches` | Submit recorded round speeches for transcription and analytics |
| `/api/ai/response` | Generate Debby's opponent speech |
| `/api/ai/judgment` | Judge a completed round and generate flow/RFD feedback |
| `/api/drills` | Generate drills |
| `/api/drills/{drill_id}/score` | Score written drills |
| `/api/drills/{drill_id}/score-audio` | Score audio drills |
| `/api/drills/{drill_id}/score-speed` | Score speed-reading recordings |

## Notes

- Browser microphone permissions must be enabled for recording features.
- Supabase environment variables are required for authentication and persisted round history.
- `OPENAI_API_KEY` and `ASSEMBLYAI_API_KEY` are required for AI generation and speech transcription.
- The active application stack lives in `apps/api` and `apps/web`.

## License

No license file is currently included.
