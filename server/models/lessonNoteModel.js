const mongoose = require('mongoose');

const lessonNoteSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    subStrand: { type: mongoose.Schema.Types.ObjectId, ref: 'SubStrand', required: true },
    content: { type: String, required: true },
    generationContext: {
      facilitatorName: String,
      term: String,
      week: String,
      weekEnding: String,
      dayDate: String,
      duration: String,
      classSize: Number,
      contentStandardCode: String,
      indicatorCodes: String,
      reference: String,
      sessionsPerWeek: { type: Number, default: 1 },
      sessionPlan: String,
      classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
      subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
      strandName: String,
      subStrandName: String,
      curriculumEntryId: mongoose.Schema.Types.ObjectId,
      generationMethod: String,
    },
    aiProvider: { type: String },
    aiModel: { type: String },
    aiGeneratedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LessonNote', lessonNoteSchema);
