import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import teacherService from './teacherService';

const initialState = {
  lessonNotes: [],
  draftLearnerNotes: [],
  quizzes: [],
  bundles: [], // ✅ NEW: List of all lesson bundles
  currentNote: null,
  currentBundle: null, // ✅ NEW: Currently viewed bundle
  currentQuiz: null, // ✅ NEW: quiz details when viewing
  analytics: {},
  schoolCalendar: null,
  aiInsights: null,
  bundleResult: null, // ✅ NEW: Store the complete lesson bundle
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
};

// Helper for consistent async thunks
const createTeacherThunk = (name, serviceCall) =>
  createAsyncThunk(`teacher/${name}`, async (arg, thunkAPI) => {
    try {
      return await serviceCall(arg);
    } catch (error) {
      const message =
        error.response?.data?.message || error.message || error.toString();
      return thunkAPI.rejectWithValue(message);
    }
  });

// --- Async Thunks ---
export const getMyLessonNotes = createTeacherThunk('getMyLessonNotes', teacherService.getMyLessonNotes);
export const generateLessonNote = createTeacherThunk('generateLessonNote', teacherService.generateLessonNote);
export const getLessonNoteById = createTeacherThunk('getLessonNoteById', teacherService.getLessonNoteById);
export const deleteLessonNote = createTeacherThunk('deleteLessonNote', teacherService.deleteLessonNote);
export const deleteLessonNotes = createTeacherThunk('deleteLessonNotes', teacherService.deleteLessonNotes);
export const generateLearnerNote = createTeacherThunk('generateLearnerNote', teacherService.generateLearnerNote);
export const generateLearnerNoteFromStrand = createTeacherThunk('generateLearnerNoteFromStrand', teacherService.generateLearnerNoteFromStrand);
export const getTeacherAnalytics = createTeacherThunk('getTeacherAnalytics', teacherService.getTeacherAnalytics);
export const getSchoolCalendar = createTeacherThunk('getSchoolCalendar', teacherService.getSchoolCalendar);
export const getDraftLearnerNotes = createTeacherThunk('getDraftLearnerNotes', teacherService.getDraftLearnerNotes);
export const publishLearnerNote = createTeacherThunk('publishLearnerNote', teacherService.publishLearnerNote);
export const deleteLearnerNote = createTeacherThunk('deleteLearnerNote', teacherService.deleteLearnerNote);
export const generateAiQuiz = createTeacherThunk('generateAiQuiz', teacherService.generateAiQuiz);
export const getAiInsights = createTeacherThunk('getAiInsights', teacherService.getAiInsights); // new
export const generateLessonBundle = createTeacherThunk('generateLessonBundle', teacherService.generateLessonBundle); // ✅ NEW: Bundle generation

// ✅ NEW: Bundle CRUD operations
export const getMyBundles = createTeacherThunk('getMyBundles', teacherService.getMyBundles);
export const getBundleById = createTeacherThunk('getBundleById', teacherService.getBundleById);
export const updateBundle = createTeacherThunk('updateBundle', teacherService.updateBundle);
export const deleteBundle = createTeacherThunk('deleteBundle', teacherService.deleteBundle);
export const duplicateBundle = createTeacherThunk('duplicateBundle', teacherService.duplicateBundle);

// ✅ NEW: Quiz operations
export const getMyQuizzes = createTeacherThunk('getMyQuizzes', teacherService.getMyQuizzes);
export const deleteQuiz = createTeacherThunk('deleteQuiz', teacherService.deleteQuiz);
export const getQuizById = createTeacherThunk('getQuizById', teacherService.getQuizById);

export const teacherSlice = createSlice({
  name: 'teacher',
  initialState,
  reducers: {
    resetTeacherState: (state) => {
      state.isLoading = false;
      state.isError = false;
      state.isSuccess = false;
      state.message = '';
    },
    resetCurrentNote: (state) => {
      state.currentNote = null;
    },
    clearCurrentQuiz: (state) => {
      state.currentQuiz = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getMyLessonNotes.fulfilled, (state, action) => {
        state.lessonNotes = action.payload;
        state.isSuccess = true;
      })
      .addCase(generateLessonNote.fulfilled, (state, action) => {
        state.lessonNotes.unshift(action.payload);
        state.isSuccess = true;
        state.message = 'Lesson note generated successfully!';
      })
      .addCase(getLessonNoteById.fulfilled, (state, action) => {
        state.currentNote = action.payload;
        state.isSuccess = true;
      })
      .addCase(deleteLessonNote.fulfilled, (state, action) => {
        state.lessonNotes = state.lessonNotes.filter(
          (note) => note._id !== action.payload.id
        );
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(deleteLessonNotes.fulfilled, (state, action) => {
        const deletedIds = new Set(action.payload.ids || []);
        state.lessonNotes = state.lessonNotes.filter((note) => !deletedIds.has(note._id));
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(generateLearnerNote.fulfilled, (state, action) => {
        state.draftLearnerNotes.unshift(action.payload);
        state.isSuccess = true;
        state.message = 'Learner note generated successfully!';
      })
      .addCase(generateLearnerNoteFromStrand.fulfilled, (state, action) => {
        state.draftLearnerNotes.unshift(action.payload);
        state.isSuccess = true;
        state.message = 'Learner note generated successfully!';
      })
      .addCase(getDraftLearnerNotes.fulfilled, (state, action) => {
        state.draftLearnerNotes = action.payload;
        state.isSuccess = true;
      })
      .addCase(publishLearnerNote.fulfilled, (state, action) => {
        state.draftLearnerNotes = state.draftLearnerNotes.map((note) => (
          note._id === action.payload.id ? { ...note, status: 'published' } : note
        ));
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(deleteLearnerNote.fulfilled, (state, action) => {
        state.draftLearnerNotes = state.draftLearnerNotes.filter(
          (note) => note._id !== action.payload.id
        );
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(generateAiQuiz.fulfilled, (state, action) => {
        state.quizzes.unshift(action.payload);
        state.isSuccess = true;
        state.message = 'AI Quiz generated successfully!';
      })

      // ✅ THE FIX IS HERE: This case was missing
      .addCase(getTeacherAnalytics.fulfilled, (state, action) => {
        state.analytics = action.payload;
        state.isSuccess = true;
      })
      .addCase(getSchoolCalendar.fulfilled, (state, action) => {
        state.schoolCalendar = action.payload;
        state.isSuccess = true;
      })

      // 🧠 AI Insights fulfilled
      .addCase(getAiInsights.fulfilled, (state, action) => {
        state.aiInsights = action.payload;
      })

      // 🎓 NEW: Lesson Bundle fulfilled
      .addCase(generateLessonBundle.fulfilled, (state, action) => {
        state.bundleResult = action.payload;
        // Also add to bundles list
        if (action.payload.bundle) {
          state.bundles.unshift(action.payload.bundle);
        }
        state.isSuccess = true;
        state.message = 'Lesson bundle generated successfully!';
      })

      // ✅ NEW: Bundle CRUD cases
      .addCase(getMyBundles.fulfilled, (state, action) => {
        state.bundles = action.payload;
        state.isSuccess = true;
      })
      .addCase(getBundleById.fulfilled, (state, action) => {
        state.currentBundle = action.payload;
        state.isSuccess = true;
      })
      .addCase(updateBundle.fulfilled, (state, action) => {
        const index = state.bundles.findIndex(b => b._id === action.payload.bundle._id);
        if (index !== -1) {
          state.bundles[index] = action.payload.bundle;
        }
        if (state.currentBundle?._id === action.payload.bundle._id) {
          state.currentBundle = action.payload.bundle;
        }
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(deleteBundle.fulfilled, (state, action) => {
        state.bundles = state.bundles.filter(b => b._id !== action.payload.id);
        if (state.currentBundle?._id === action.payload.id) {
          state.currentBundle = null;
        }
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(duplicateBundle.fulfilled, (state, action) => {
        state.bundles.unshift(action.payload.bundle);
        state.isSuccess = true;
        state.message = action.payload.message;
      })

      // ✅ NEW: Quiz cases
      .addCase(getMyQuizzes.fulfilled, (state, action) => {
        state.quizzes = action.payload;
        state.isSuccess = true;
      })
      .addCase(deleteQuiz.fulfilled, (state, action) => {
        state.quizzes = state.quizzes.filter(q => q._id !== action.payload.id);
        state.isSuccess = true;
        state.message = action.payload.message;
      })
      .addCase(getQuizById.fulfilled, (state, action) => {
        state.currentQuiz = action.payload;
        state.isSuccess = true;
      })

      // Generic loaders
      .addMatcher(
        (action) => action.type.startsWith('teacher/') && action.type.endsWith('/pending'),
        (state) => {
          state.isLoading = true;
          state.isSuccess = false;
          state.isError = false;
        }
      )
      .addMatcher(
        (action) => action.type.startsWith('teacher/') && action.type.endsWith('/fulfilled'),
        (state) => {
          state.isLoading = false;
        }
      )
      .addMatcher(
        (action) => action.type.startsWith('teacher/') && action.type.endsWith('/rejected'),
        (state, action) => {
          state.isLoading = false;
          state.isError = true;
          state.message = action.payload;
        }
      );
  },
});

export const { resetTeacherState, resetCurrentNote } = teacherSlice.actions;
export default teacherSlice.reducer;