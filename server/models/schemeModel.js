const mongoose = require('mongoose');

const indicatorSchema = new mongoose.Schema({
  code: { type: String, trim: true },
  description: { type: String, trim: true },
}, { _id: false });

const schemeEntrySchema = new mongoose.Schema({
  weeks: [{ type: Number, required: true }],
  strand: { type: String, trim: true },
  subStrand: { type: String, trim: true },
  contentStandard: { type: String, trim: true },
  indicators: [indicatorSchema],
  topic: { type: String, trim: true },
  activities: { type: String, trim: true },
  sourceRow: { type: Number },
  needsReview: { type: Boolean, default: false },
  reviewReasons: [{ type: String }],
}, { _id: true });

const schemeSchema = new mongoose.Schema({
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  term: { type: String, required: true, trim: true },
  originalFileName: { type: String, required: true, trim: true },
  fileType: { type: String, required: true, trim: true },
  importStatus: {
    type: String,
    enum: ['pending_review', 'confirmed', 'archived'],
    default: 'pending_review',
    index: true,
  },
  contextWarnings: [{ type: String }],
  entries: [schemeEntrySchema],
}, { timestamps: true });

schemeSchema.index({ teacher: 1, class: 1, subject: 1, term: 1, importStatus: 1 });

module.exports = mongoose.model('Scheme', schemeSchema);