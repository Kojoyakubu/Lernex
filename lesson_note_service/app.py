from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field
from sqlalchemy import (Column, Integer, String, Text, DateTime, create_engine)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from generator import build_lesson_note
from bson.objectid import ObjectId

DATABASE_URL = os.environ.get("DATABASE_URL")
if DATABASE_URL:
    ENGINE_URL = DATABASE_URL
else:
    # fallback to local sqlite file
    BASE_DIR = os.path.dirname(__file__)
    ENGINE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'lesson_notes.db')}"

engine = create_engine(ENGINE_URL, connect_args={"check_same_thread": False} if ENGINE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Optional MongoDB connection (connect to main site's DB when MONGO_URI provided)
MONGO_URI = os.environ.get("MONGO_URI")
mongo_client = None
mongo_db = None
mongo_collection = None
if MONGO_URI:
    try:
        from pymongo import MongoClient

        mongo_client = MongoClient(MONGO_URI)
        # If database name included in URI, get_default_database() will return it
        mongo_db = mongo_client.get_default_database() or mongo_client[os.environ.get("MONGO_DB_NAME", "lernex")]
        mongo_collection = mongo_db["lessonnotes"]
    except Exception:
        mongo_client = None
        mongo_db = None
        mongo_collection = None


class LessonNoteModel(Base):
    __tablename__ = "lesson_notes"
    id = Column(Integer, primary_key=True, index=True)
    facilitator_name = Column(String, nullable=False)
    school = Column(String, nullable=False)
    term = Column(String, nullable=False)
    week = Column(String, nullable=False)
    week_ending = Column(String, nullable=False)
    day_date = Column(String, nullable=False)
    duration = Column(String, nullable=False)
    class_name = Column(String, nullable=False)
    class_size = Column(Integer, nullable=False)
    subject_name = Column(String, nullable=False)
    strand_name = Column(String, nullable=False)
    sub_strand_name = Column(String, nullable=False)
    content_standard_code = Column(String, nullable=False)
    indicator_codes = Column(String, nullable=False)
    reference = Column(String, nullable=False)
    topic = Column(String, nullable=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Lernex Lesson Note Generator", version="1.0.0")


class LessonNoteRequest(BaseModel):
    facilitator_name: str = Field(..., description="Teacher or facilitator name")
    school: str = Field(..., description="School name")
    term: str = Field(..., description="School term")
    week: str = Field(..., description="Current week")
    week_ending: str = Field(..., description="Week ending date")
    day_date: str = Field(..., description="Day and date")
    duration: str = Field(..., description="Lesson duration")
    class_name: str = Field(..., description="Class name")
    class_size: int = Field(..., description="Class size")
    subject_name: str = Field(..., description="Subject name")
    strand_name: str = Field(..., description="Strand name")
    sub_strand_name: str = Field(..., description="Sub-strand name")
    content_standard_code: str = Field(..., description="Content standard code")
    indicator_codes: str = Field(..., description="Official indicator code(s)")
    reference: str = Field(..., description="Reference text")
    topic: str | None = Field(default=None, description="Optional topic override")


class LessonNoteResponse(BaseModel):
    id: str
    content: str
    created_at: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/lesson-notes/generate", response_model=LessonNoteResponse)
def generate_lesson_note(payload: LessonNoteRequest) -> LessonNoteResponse:
    payload_dict = payload.model_dump()
    content = build_lesson_note(payload_dict)
    only_mongo = str(os.environ.get("ONLY_MONGO", "false")).lower() == "true"

    def _to_objectid(val: Any):
        if not val:
            return None
        try:
            return ObjectId(str(val))
        except Exception:
            return val

    # If ONLY_MONGO is enabled and Mongo is available, skip local SQL storage
    if only_mongo and mongo_collection is not None:
        try:
            doc = {
                "teacher": _to_objectid(payload_dict.get("teacher_id")) or None,
                "school": _to_objectid(payload_dict.get("school_id")) or payload.school,
                "subStrand": _to_objectid(payload_dict.get("sub_strand_id")) or None,
                "content": content,
                "generationContext": {
                    "facilitatorName": payload.facilitator_name,
                    "term": payload.term,
                    "week": payload.week,
                    "weekEnding": payload.week_ending,
                    "dayDate": payload.day_date,
                    "duration": payload.duration,
                    "classSize": payload.class_size,
                    "contentStandardCode": payload.content_standard_code,
                    "indicatorCodes": payload.indicator_codes,
                    "reference": payload.reference,
                    "sessionsPerWeek": 1,
                    "sessionPlan": "",
                },
                "aiProvider": "openai" if os.environ.get("OPENAI_API_KEY") else "template",
                "aiModel": os.environ.get("OPENAI_MODEL", "") or "",
                "aiGeneratedAt": datetime.utcnow(),
            }
            res = mongo_collection.insert_one(doc)
            mongo_id = str(res.inserted_id)
            created_at = datetime.utcnow().isoformat()
            return LessonNoteResponse(id=mongo_id, content=content, created_at=created_at)
        except Exception:
            # fallback to SQL storage if mongo insert fails
            only_mongo = False

    # Default behavior: save locally (SQL) and optionally mirror to Mongo
    db = SessionLocal()
    note = LessonNoteModel(
        facilitator_name=payload.facilitator_name,
        school=payload.school,
        term=payload.term,
        week=payload.week,
        week_ending=payload.week_ending,
        day_date=payload.day_date,
        duration=payload.duration,
        class_name=payload.class_name,
        class_size=payload.class_size,
        subject_name=payload.subject_name,
        strand_name=payload.strand_name,
        sub_strand_name=payload.sub_strand_name,
        content_standard_code=payload.content_standard_code,
        indicator_codes=payload.indicator_codes,
        reference=payload.reference,
        topic=payload.topic,
        content=content,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    db.close()

    # If configured, also insert into main MongoDB to keep site in sync
    mongo_id = None
    if mongo_collection is not None:
        try:
            doc = {
                "teacher": _to_objectid(payload_dict.get("teacher_id")) or None,
                "school": _to_objectid(payload_dict.get("school_id")) or payload.school,
                "subStrand": _to_objectid(payload_dict.get("sub_strand_id")) or None,
                "content": content,
                "generationContext": {
                    "facilitatorName": payload.facilitator_name,
                    "term": payload.term,
                    "week": payload.week,
                    "weekEnding": payload.week_ending,
                    "dayDate": payload.day_date,
                    "duration": payload.duration,
                    "classSize": payload.class_size,
                    "contentStandardCode": payload.content_standard_code,
                    "indicatorCodes": payload.indicator_codes,
                    "reference": payload.reference,
                    "sessionsPerWeek": 1,
                    "sessionPlan": "",
                },
                "aiProvider": "openai" if os.environ.get("OPENAI_API_KEY") else "template",
                "aiModel": os.environ.get("OPENAI_MODEL", "") or "",
                "aiGeneratedAt": datetime.utcnow(),
            }
            res = mongo_collection.insert_one(doc)
            mongo_id = str(res.inserted_id)
        except Exception:
            mongo_id = None

    return LessonNoteResponse(id=str(note.id), content=note.content, created_at=note.created_at.isoformat())


@app.get("/api/lesson-notes")
def list_lesson_notes() -> list[dict[str, Any]]:
    db = SessionLocal()
    rows = db.query(LessonNoteModel).order_by(LessonNoteModel.id.desc()).all()
    result = [
        {
            "id": r.id,
            "facilitator_name": r.facilitator_name,
            "school": r.school,
            "subject_name": r.subject_name,
            "strand_name": r.strand_name,
            "sub_strand_name": r.sub_strand_name,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
    db.close()
    return result
