Standalone Python lesson-note service.

Run:
  python -m uvicorn app:app --app-dir lesson_note_service --host 127.0.0.1 --port 8000

Example request:
  POST /api/lesson-notes/generate
  {
    "facilitator_name": "Ama Owusu",
    "school": "Kumasi Anglican SHS",
    "term": "Term 2",
    "week": "Week 4",
    "week_ending": "24-05-2026",
    "day_date": "Monday, 24-05-2026",
    "duration": "60 minutes",
    "class_name": "JHS 2",
    "class_size": 32,
    "subject_name": "Mathematics",
    "strand_name": "Number",
    "sub_strand_name": "Fractions",
    "content_standard_code": "B7.3.1",
    "indicator_codes": "B7.3.1.1",
    "reference": "Curriculum Guide",
    "topic": "Fractions"
  }

  Environment
  -----------
  Create a `.env` file at the service root before running the app. You can copy
  the provided example and fill in the keys:

  Windows:

  ```
  copy .env.example .env
  ```

  Linux/macOS:

  ```
  cp .env.example .env
  ```

  Important environment variables (see `.env.example`):

  - `MONGO_URI`: MongoDB connection string used to insert generated lesson notes into the
    main site's `lessonnotes` collection.
  - `MONGO_DB`: optional DB name to use (defaults to the DB in the URI).
  - `OPENAI_API_KEY`, `OPENAI_MODEL`: OpenAI credentials and model name.
  - `OPENROUTER_API_KEY`, `OPENROUTER_API_BASE`, `OPENROUTER_MODEL_MAIN`: OpenRouter proxy values (use to access Gemini via a router).
  - `GROQ_API_KEY`, `GROQ_API_BASE`: Groq provider keys (optional).
  - `BLOCK_GROQ`: set to `true` to skip Groq even when `GROQ_API_KEY` is present.
  - `ONLY_MONGO`: when `true` the service will skip local SQL storage and save only to MongoDB.
  - `PORT`: port the FastAPI/Uvicorn server listens on.

  After creating `.env` run the service (example):

  ```
  pip install -r requirements.txt
  uvicorn app:app --reload --port 8001
  ```

  Deploying to Render
  -------------------
  This repository includes a `render.yaml` at the project root that configures a
  Python web service for the `lesson_note_service` folder. To deploy on Render:

  1. Push your repo to GitHub (or a Git provider supported by Render).
  2. In the Render dashboard create a new web service and connect your repo, or
    just import using the `render.yaml` file.
  3. Set the required environment variables in the service's Settings → Environment
    section (do NOT commit secrets to the repo). At minimum set:

  - `MONGO_URI` — your MongoDB connection string.
  - `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) — an LLM provider key.
  - `ONLY_MONGO` — set to `true` to skip local SQL storage and write only to MongoDB.

  Render will run the `buildCommand` and `startCommand` defined in `render.yaml`.

