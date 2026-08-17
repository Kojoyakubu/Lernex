from __future__ import annotations

import os
from datetime import datetime
from typing import Any

try:
    import openai
except Exception:
    openai = None


DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-3.5-turbo")


def _template(payload: dict[str, Any]) -> str:
    school = payload.get("school", "[School Name]")
    facilitator_name = payload.get("facilitator_name", "[Facilitator Name]")
    term = payload.get("term", "Term 1")
    week = payload.get("week", "Week 1")
    week_ending = payload.get("week_ending", "[Week Ending]")
    day_date = payload.get("day_date", "[Day/Date]")
    duration = payload.get("duration", "60 minutes")
    class_name = payload.get("class_name", "JHS 1")
    class_size = payload.get("class_size", 30)
    subject_name = payload.get("subject_name", "English Language")
    strand_name = payload.get("strand_name", "Reading and Writing")
    sub_strand_name = payload.get("sub_strand_name", "Comprehension")
    content_standard_code = payload.get("content_standard_code", "[Code]")
    indicator_codes = payload.get("indicator_codes", "[Indicator]")
    reference = payload.get("reference", "[Reference]")
    topic = payload.get("topic") or sub_strand_name

    return f"""### TEACHER INFORMATION
**School:** {school}
**Term:** {term}
**Week:** {week}
**Week Ending:** {week_ending}
**Class:** {class_name}
**Class Size:** {class_size}
**Subject:** {subject_name}
**Strand:** {strand_name}
**Sub-Strand:** {sub_strand_name}
**Day/Date:** {day_date}
**Time/Duration:** {duration}
**Content Standard (Code):** {content_standard_code}
**Indicator(s):** {indicator_codes}
**Performance Indicator:** The learner can explain the main idea and key details of the lesson topic.
**Core Competencies:** Critical thinking, communication, collaboration.
**Teaching & Learning Materials:** textbook, flashcards, board illustrations, learner worksheets.
**Reference:** {reference}

### LESSON OBJECTIVE
By the end of the lesson, learners should be able to explain the meaning of {topic} and use it correctly in context.

### LESSON PHASES
| **PHASE 1: Starter (Preparing the Brain)** | **PHASE 2: Main (New Learning & Assessment)** | **PHASE 3: Plenary/Reflection** |
|:---|:---:|---:|
| **Recap:** Review a previous related topic from the lesson series.<br><br>**Engaging Activity:** Ask learners to mention one real-life example of {topic}.<br><br>**Introduction:** State the lesson objective clearly on the board. | **Activity 1:** Demonstrate the concept of {topic} using simple examples.<br><br>**Activity 2:** Let learners work in pairs to discuss and complete a short task.<br><br>**Evaluation:** Ask 2–3 short oral questions to check understanding.<br><br>**Assignment:** Write two sentences using {topic} in context. | **Recap:** Summarize the key points from the lesson.<br><br>**Learner Reflection:** Ask learners what they found easy or difficult.<br><br>**Real-Life Application:** Show how {topic} connects to daily classroom and home activities. |

### MULTIPLE CHOICE QUESTIONS
1. Which of the following best explains {topic}?
   A. A short explanation of a concept
   B. A long story with no learning value
   C. A classroom rule only
   D. A general statement with no purpose

### APPLICATION QUESTIONS
1. In your own words, explain what {topic} means.
2. Give two examples where {topic} can be used in a real-life situation.

**Facilitator:** {facilitator_name}
**Vetted By:** ....................................................
**Signature:** ....................................................
**Date:** {datetime.now().strftime('%d-%m-%Y')}
"""


def build_lesson_note(payload: dict[str, Any]) -> str:
    """Build a lesson note using the best available provider.

    Provider preference order:
    1. OpenRouter (if `OPENROUTER_API_KEY` is present) — can proxy Gemini
    2. OpenAI (if `OPENAI_API_KEY` is present)
    3. Groq (if `GROQ_API_KEY` is present and not blocked)
    Falls back to the local template when no provider is available or on errors.
    """
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    groq_key = os.environ.get("GROQ_API_KEY")
    block_groq = str(os.environ.get("BLOCK_GROQ", "")).lower() == "true"

    provider = None
    api_key = None
    api_base = None
    model = None

    if openrouter_key:
        provider = "openrouter"
        api_key = openrouter_key
        api_base = os.environ.get("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1")
        model = os.environ.get("OPENROUTER_MODEL_MAIN", os.environ.get("OPENROUTER_MODEL", "tencent/hy3-preview:free"))
    elif openai_key:
        provider = "openai"
        api_key = openai_key
        model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    elif groq_key and not block_groq:
        provider = "groq"
        api_key = groq_key
        api_base = os.environ.get("GROQ_API_BASE", "https://api.groq.com/openai/v1")
        model = os.environ.get("GROQ_MODEL_MAIN", os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"))
    else:
        provider = None

    if provider and openai:
        try:
            openai.api_key = api_key
            if api_base:
                openai.api_base = api_base

            school = payload.get("school", "[School Name]")
            facilitator_name = payload.get("facilitator_name", "[Facilitator Name]")
            term = payload.get("term", "Term 1")
            week = payload.get("week", "Week 1")
            week_ending = payload.get("week_ending", "[Week Ending]")
            day_date = payload.get("day_date", "[Day/Date]")
            duration = payload.get("duration", "60 minutes")
            class_name = payload.get("class_name", "JHS 1")
            class_size = payload.get("class_size", 30)
            subject_name = payload.get("subject_name", "English Language")
            strand_name = payload.get("strand_name", "Reading and Writing")
            sub_strand_name = payload.get("sub_strand_name", "Comprehension")
            content_standard_code = payload.get("content_standard_code", "[Code]")
            indicator_codes = payload.get("indicator_codes", "[Indicator]")
            reference = payload.get("reference", "[Reference]")
            topic = payload.get("topic") or sub_strand_name

            system_prompt = (
                "You are an expert Ghanaian basic school teacher. "
                "Produce a lesson note in Markdown following BECE/NaCCA style. "
                "Include sections: TEACHER INFORMATION, LESSON OBJECTIVE, LESSON PHASES, MULTIPLE CHOICE QUESTIONS, APPLICATION QUESTIONS. "
                "Do not add introductions or extra commentary."
            )

            user_prompt = f"""
Teacher info:
School: {school}
Facilitator: {facilitator_name}
Term: {term}
Week: {week}
Week Ending: {week_ending}
Day/Date: {day_date}
Duration: {duration}
Class: {class_name}
Class Size: {class_size}
Subject: {subject_name}
Strand: {strand_name}
Sub-Strand: {sub_strand_name}
Content Standard Code: {content_standard_code}
Indicator(s): {indicator_codes}
Reference: {reference}

Produce the lesson note. Keep Ghanaian context and examples.
"""

            resp = openai.ChatCompletion.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.35,
                max_tokens=1600,
            )
            text = resp.choices[0].message.content.strip()
            return text
        except Exception:
            return _template(payload)

    return _template(payload)


