import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';

// Redux & Components
import { syncUserFromStorage } from '../features/auth/authSlice';
import {
  fetchItems,
  fetchChildren,
  clearChildren,
} from '../features/curriculum/curriculumSlice';
import {
  generateLessonNote,
  getMyLessonNotes,
  deleteLessonNote,
  generateLearnerNote,
  generateLearnerNoteFromStrand,
  getDraftLearnerNotes,
  publishLearnerNote,
  deleteLearnerNote as deleteDraftLearnerNote,
  resetTeacherState,
  getMyBundles,
  getTeacherAnalytics,
  getSchoolCalendar,
  generateLessonBundle,
  generateAiQuiz,
  getMyQuizzes,
  deleteQuiz,
  getQuizById,
} from '../features/teacher/teacherSlice';

// utilities for image extraction & fetching
import { segmentHtmlWithImages, removeImageBlocks } from '../utils/imageExtractor';
import { fetchImageForQuery } from '../services/imageService';
import { downloadAsPdf } from '../utils/downloadHelper';
import teacherService from '../features/teacher/teacherService';
import LessonBundleForm from '../components/LessonBundleForm'; 
import BundleResultViewer from '../components/BundleResultViewer';
import DashboardBanner from '../components/DashboardBanner';
import CurriculumSelection from '../components/CurriculumSelection';
import LessonNoteForm from '../components/LessonNoteForm';
import LessonNotePickerDialog from '../components/LessonNotePickerDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import AnalyticsDialog from '../components/AnalyticsDialog';
import NotePreviewDialog from '../components/NotePreviewDialog';

import useContentProtection from '../hooks/useContentProtection';

// MUI Imports
import {
  Box,
  Typography,
  Button,
  Grid,
  Select,
  MenuItem,
  Menu,
  FormControl,
  InputLabel,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Stack,
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Alert,
  Tooltip,
  Divider,
  Chip,
  TextField,
  Checkbox,
  useTheme,
  useMediaQuery,
} from '@mui/material';

// Icon Imports
import {
  Article,
  FaceRetouchingNatural,
  Quiz,
  School,
  Download,
  ExpandMore,
  OpenInFull,
  CloseFullscreen,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';

const INITIAL_SELECTIONS = { level: '', class: '', subject: '', strand: '', subStrand: '' };
const INITIAL_STRAND_FORM = {
  term: '',
  week: '',
  dayDate: '',
  duration: '',
  classSize: '',
  contentStandardCode: '',
  indicatorCodes: '',
  reference: '',
  preferredProvider: '',
  preferredModel: '',
};

/* ── shared style tokens (module-scope, stable references) ─────────────── */

const overviewCardSx = {
  p: { xs: 1.4, sm: 2.25 },
  minHeight: { xs: 112, sm: 184 },
  borderRadius: 3,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  border: '1px solid',
  transition: 'transform 0.22s ease, box-shadow 0.22s ease',
  '&:hover': { transform: 'translateY(-4px)', boxShadow: 4 },
};

const toolTileSx = {
  height: '100%',
  p: 2,
  borderRadius: 3,
  textAlign: 'center',
  cursor: 'pointer',
  border: '1.5px solid',
  borderColor: '#D0DAE4',
  bgcolor: '#EEF2F5',
  boxShadow: '0 2px 10px rgba(79,102,120,0.08)',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
  '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 6px 20px rgba(79,102,120,0.18)', borderColor: 'primary.main' },
};

const toolImageSx = {
  width: { xs: 60, sm: 100, md: 120 },
  height: { xs: 60, sm: 100, md: 120 },
  margin: { xs: '0 auto 8px', sm: '0 auto 12px' },
  borderRadius: 2,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  boxShadow: 2,
};

const dialogBodySx = {
  overflowY: 'auto',
  bgcolor: 'background.default',
  py: 2,
};

const dialogFilterPanelSx = {
  mb: 2,
  p: 2,
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.paper',
};

const dialogListCardSx = {
  mb: 1.5,
  p: 1.5,
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: 0,
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
};

const selectableListItemSx = {
  alignItems: 'flex-start',
  borderRadius: 1.5,
  mx: 0.75,
  my: 0.4,
  '&.Mui-selected': { bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.main' },
  '&.Mui-selected:hover': { bgcolor: 'primary.100' },
};

/* ── small shared sub-components ────────────────────────────────────────── */

function DialogTitleWithFullscreen({ title, isFullscreen, onToggle }) {
  return (
    <DialogTitle sx={{ pb: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          <IconButton size="small" aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={onToggle}>
            {isFullscreen ? <CloseFullscreen fontSize="small" /> : <OpenInFull fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </DialogTitle>
  );
}

function ToolTile({ label, imageUrl, onClick, toolTileSx, toolImageSx }) {
  return (
    <Grid item xs={6} sm={3}>
      <Paper onClick={onClick} sx={{ ...toolTileSx, p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{ ...toolImageSx, backgroundImage: `url('${imageUrl}')` }} />
        <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'center', color: 'text.primary', fontSize: { xs: '0.72rem', sm: '0.875rem' } }}>
          {label}
        </Typography>
      </Paper>
    </Grid>
  );
}

function TeacherDashboard() {
  const dispatch = useDispatch();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const DOWNLOAD_FEE_GHS = 0.5;

  // Redux state
  const { user } = useSelector((state) => state.auth || {});
  const { levels, classes, subjects, strands, subStrands } = useSelector((state) => state.curriculum);
  const {
    lessonNotes,
    draftLearnerNotes,
    quizzes,
    bundles,
    currentQuiz,
    isLoading,
    teacherAnalytics,
    bundleResult,
    schoolCalendar,
  } = useSelector((state) => state.teacher);


  // Local state
  const [selections, setSelections] = useState(INITIAL_SELECTIONS);
  const [noteToDelete, setNoteToDelete] = useState(null);
  const [viewingNote, setViewingNote] = useState(null);
  const [previewSegments, setPreviewSegments] = useState([]);
  const [selectedLessonForLearner, setSelectedLessonForLearner] = useState('');
  const [selectedLessonForQuiz, setSelectedLessonForQuiz] = useState('');
  const [quizSelectedSubStrands, setQuizSelectedSubStrands] = useState([]);
  const [lessonPlanSelectedSubStrands, setLessonPlanSelectedSubStrands] = useState([]);
  const [notesClassFilter, setNotesClassFilter] = useState('');
  const [notesSubjectFilter, setNotesSubjectFilter] = useState('');
  const [learnerNotesClassFilter, setLearnerNotesClassFilter] = useState('');
  const [learnerNotesSubjectFilter, setLearnerNotesSubjectFilter] = useState('');
  const [selectedNoteIds, setSelectedNoteIds] = useState(new Set());
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkDownloadMenuAnchorEl, setBulkDownloadMenuAnchorEl] = useState(null);
  const [downloadMenuAnchorEl, setDownloadMenuAnchorEl] = useState(null);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [isChargingDownload, setIsChargingDownload] = useState(false);
  const [strandForm, setStrandForm] = useState(INITIAL_STRAND_FORM);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [learnerNoteToDelete, setLearnerNoteToDelete] = useState(null);

  // View state
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateTools, setShowCreateTools] = useState(false);
  const planLoading = false;
  const [dialogFullscreen, setDialogFullscreen] = useState({});

  // Single dialog state — replaces 16 boolean flags
  // Keys: 'plan' | 'bundleSelector' | 'bundleModal' | 'bundleResult' | 'noteForm'
  //       | 'learnerOptions' | 'learnerFromLesson' | 'learnerFromStrand'
  //       | 'quizOptions' | 'quizFromLesson' | 'quizFromStrand'
  //       | 'myLessonNotes' | 'myLearnerNotes' | 'myQuizzes' | 'quizView' | 'analytics'
  const [activeDialog, setActiveDialog] = useState(null);
  const closeDialog = useCallback(() => setActiveDialog(null), []);
  const { protectionProps: quizProtectionProps, protectionSx: quizProtectionSx } = useContentProtection({
    enabled: activeDialog === 'quizView',
  });

  const overviewCards = [
    {
      key: 'lesson-notes',
      value: lessonNotes?.length || 0,
      label: 'LESSON NOTES',
      subtitle: 'Published notes',
      palette: 'primary',
      Icon: Article,
    },
    {
      key: 'draft-notes',
      value: draftLearnerNotes?.length || 0,
      label: 'DRAFT NOTES',
      subtitle: 'Pending review',
      palette: 'secondary',
      Icon: FaceRetouchingNatural,
    },
    {
      key: 'ai-quizzes',
      value: teacherAnalytics?.totalQuizzes || 0,
      label: 'AI QUIZZES',
      subtitle: 'Total generated',
      palette: 'warning',
      Icon: Quiz,
    },
    {
      key: 'students-reached',
      value: teacherAnalytics?.totalStudents || 0,
      label: 'STUDENTS REACHED',
      subtitle: 'Across all classes',
      palette: 'success',
      Icon: School,
    },
  ];

  const isDialogFullscreen = useCallback((dialogKey) => isMobile || !!dialogFullscreen[dialogKey], [dialogFullscreen, isMobile]);
  const toggleDialogFullscreen = useCallback((dialogKey) => {
    setDialogFullscreen((prev) => ({ ...prev, [dialogKey]: !prev[dialogKey] }));
  }, []);

  const resetSelections = useCallback(() => {
    setSelections(INITIAL_SELECTIONS);
    setLessonPlanSelectedSubStrands([]);
  }, []);

  const resetStrandForm = useCallback(() => {
    setStrandForm(INITIAL_STRAND_FORM);
  }, []);

  const lessonNoteClassOptions = useMemo(() => {
    const classMap = new Map();
    (lessonNotes || []).forEach((note) => {
      const classObj = note?.subStrand?.strand?.subject?.class;
      const classId = classObj?._id || classObj?.name;
      const className = classObj?.name;
      if (classId && className && !classMap.has(String(classId))) {
        classMap.set(String(classId), { id: String(classId), name: className });
      }
    });
    return Array.from(classMap.values()).sort((first, second) => first.name.localeCompare(second.name));
  }, [lessonNotes]);

  const lessonNoteSubjectOptions = useMemo(() => {
    if (!notesClassFilter) return [];
    const subjectMap = new Map();
    (lessonNotes || []).forEach((note) => {
      const classObj = note?.subStrand?.strand?.subject?.class;
      const noteClassId = classObj?._id || classObj?.name;
      if (String(noteClassId) !== String(notesClassFilter)) return;

      const subjectObj = note?.subStrand?.strand?.subject;
      const subjectId = subjectObj?._id || subjectObj?.name;
      const subjectName = subjectObj?.name;
      if (subjectId && subjectName && !subjectMap.has(String(subjectId))) {
        subjectMap.set(String(subjectId), { id: String(subjectId), name: subjectName });
      }
    });
    return Array.from(subjectMap.values()).sort((first, second) => first.name.localeCompare(second.name));
  }, [lessonNotes, notesClassFilter]);

  const lessonNotesBySelection = useMemo(() => {
    if (!notesClassFilter || !notesSubjectFilter) return [];
    return (lessonNotes || []).filter((note) => {
      const classObj = note?.subStrand?.strand?.subject?.class;
      const subjectObj = note?.subStrand?.strand?.subject;
      const noteClassId = classObj?._id || classObj?.name;
      const noteSubjectId = subjectObj?._id || subjectObj?.name;
      return String(noteClassId) === String(notesClassFilter)
        && String(noteSubjectId) === String(notesSubjectFilter);
    });
  }, [lessonNotes, notesClassFilter, notesSubjectFilter]);

  const draftMetaBySubStrandId = useMemo(() => {
    const metaMap = new Map();
    (lessonNotes || []).forEach((note) => {
      const subStrandId = note?.subStrand?._id || note?.subStrand;
      const classObj = note?.subStrand?.strand?.subject?.class;
      const subjectObj = note?.subStrand?.strand?.subject;
      if (!subStrandId || !classObj?.name || !subjectObj?.name) return;
      metaMap.set(String(subStrandId), {
        classId: String(classObj?._id || classObj?.name),
        className: classObj?.name,
        subjectId: String(subjectObj?._id || subjectObj?.name),
        subjectName: subjectObj?.name,
      });
    });
    return metaMap;
  }, [lessonNotes]);

  const learnerNoteClassOptions = useMemo(() => {
    const classMap = new Map();
    (draftLearnerNotes || []).forEach((note) => {
      const subStrandId = String(note?.subStrand?._id || note?.subStrand || '');
      const meta = draftMetaBySubStrandId.get(subStrandId);
      if (!meta?.classId || !meta?.className || classMap.has(meta.classId)) return;
      classMap.set(meta.classId, { id: meta.classId, name: meta.className });
    });
    return Array.from(classMap.values()).sort((first, second) => first.name.localeCompare(second.name));
  }, [draftLearnerNotes, draftMetaBySubStrandId]);

  const learnerNoteSubjectOptions = useMemo(() => {
    if (!learnerNotesClassFilter) return [];
    const subjectMap = new Map();
    (draftLearnerNotes || []).forEach((note) => {
      const subStrandId = String(note?.subStrand?._id || note?.subStrand || '');
      const meta = draftMetaBySubStrandId.get(subStrandId);
      if (!meta || meta.classId !== String(learnerNotesClassFilter) || subjectMap.has(meta.subjectId)) return;
      subjectMap.set(meta.subjectId, { id: meta.subjectId, name: meta.subjectName });
    });
    return Array.from(subjectMap.values()).sort((first, second) => first.name.localeCompare(second.name));
  }, [draftLearnerNotes, draftMetaBySubStrandId, learnerNotesClassFilter]);

  const learnerNotesBySelection = useMemo(() => {
    if (!learnerNotesClassFilter || !learnerNotesSubjectFilter) return [];
    return (draftLearnerNotes || []).filter((note) => {
      const subStrandId = String(note?.subStrand?._id || note?.subStrand || '');
      const meta = draftMetaBySubStrandId.get(subStrandId);
      if (!meta) return false;
      return meta.classId === String(learnerNotesClassFilter)
        && meta.subjectId === String(learnerNotesSubjectFilter);
    });
  }, [draftLearnerNotes, draftMetaBySubStrandId, learnerNotesClassFilter, learnerNotesSubjectFilter]);

  const analyticsSummary = useMemo(() => {
    const publishedLearnerNotes = (draftLearnerNotes || []).filter((note) => note.status === 'published').length;
    const draftOnlyLearnerNotes = (draftLearnerNotes || []).filter((note) => note.status !== 'published').length;

    const now = new Date();
    const last30Days = new Date(now);
    last30Days.setDate(last30Days.getDate() - 30);

    const activityEntries = [
      ...(lessonNotes || []).map((note) => ({
        type: 'Lesson note created',
        title: note?.subStrand?.name || 'Lesson note',
        date: note?.createdAt,
      })),
      ...(draftLearnerNotes || []).map((note) => ({
        type: note?.status === 'published' ? 'Learner note published' : 'Learner note created',
        title: note?.subStrand?.name || 'Learner note',
        date: note?.createdAt,
      })),
      ...(quizzes || []).map((quiz) => ({
        type: 'Quiz generated',
        title: quiz?.title || 'Quiz',
        date: quiz?.createdAt,
      })),
      ...(bundles || []).map((bundle) => ({
        type: 'Bundle generated',
        title: bundle?.title || bundle?.subStrandName || 'Lesson bundle',
        date: bundle?.createdAt,
      })),
    ]
      .filter((entry) => !!entry.date)
      .sort((first, second) => new Date(second.date) - new Date(first.date));

    const last30Count = activityEntries.filter((entry) => new Date(entry.date) >= last30Days).length;
    const recentActivity = activityEntries.slice(0, 8);

    const topicCounts = new Map();
    [...(lessonNotes || []), ...(draftLearnerNotes || [])].forEach((note) => {
      const topicName = note?.subStrand?.name;
      if (!topicName) return;
      topicCounts.set(topicName, (topicCounts.get(topicName) || 0) + 1);
    });

    const topTopics = Array.from(topicCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((first, second) => second.count - first.count)
      .slice(0, 5);

    return {
      totalLessonNotes: lessonNotes?.length || 0,
      totalLearnerNotes: draftLearnerNotes?.length || 0,
      publishedLearnerNotes,
      draftOnlyLearnerNotes,
      totalBundles: bundles?.length || 0,
      totalQuizzes: quizzes?.length || 0,
      totalQuizAttempts: teacherAnalytics?.totalQuizAttempts || 0,
      avgQuizScore: teacherAnalytics?.averageScore || 0,
      totalNoteViews: teacherAnalytics?.totalNoteViews || 0,
      last30Count,
      recentActivity,
      topTopics,
    };
  }, [lessonNotes, draftLearnerNotes, quizzes, bundles, teacherAnalytics]);

  // Initialization & Handlers (Preserved from original)

  useEffect(() => {
    dispatch(syncUserFromStorage());
    dispatch(fetchItems({ entity: 'levels' }));
    dispatch(getMyLessonNotes());
    dispatch(getDraftLearnerNotes());
    dispatch(getTeacherAnalytics());
    dispatch(getSchoolCalendar());
    dispatch(getMyBundles());
    dispatch(getMyQuizzes());
    return () => { dispatch(resetTeacherState()); };
  }, [dispatch]);

  // clear loaded quiz details when the detail dialog is closed
  useEffect(() => {
    if (activeDialog !== 'quizView') {
      dispatch({ type: 'teacher/clearCurrentQuiz' });
    }
  }, [activeDialog, dispatch]);

  // Dependent fetches
  useEffect(() => { if (selections.level) dispatch(fetchChildren({ entity: 'classes', parentEntity: 'levels', parentId: selections.level })); }, [selections.level, dispatch]);
  useEffect(() => { if (selections.class) dispatch(fetchChildren({ entity: 'subjects', parentEntity: 'classes', parentId: selections.class })); }, [selections.class, dispatch]);
  useEffect(() => { if (selections.subject) dispatch(fetchChildren({ entity: 'strands', parentEntity: 'subjects', parentId: selections.subject })); }, [selections.subject, dispatch]);
  useEffect(() => { if (selections.strand) dispatch(fetchChildren({ entity: 'subStrands', parentEntity: 'strands', parentId: selections.strand })); }, [selections.strand, dispatch]);

  const handleSelectionChange = useCallback((e) => {
    const { name, value } = e.target;
    setSelections((prev) => {
      const next = { ...prev, [name]: value };
      const resetMap = { level: ['class', 'subject', 'strand', 'subStrand'], class: ['subject', 'strand', 'subStrand'], subject: ['strand', 'subStrand'], strand: ['subStrand'] };
      if (resetMap[name]) {
        resetMap[name].forEach((k) => (next[k] = ''));
        dispatch(clearChildren({ entities: resetMap[name] }));
        // if topic selections change, clear any previously queued strands for quizzes
        setQuizSelectedSubStrands([]);
        if (name === 'level' || name === 'class' || name === 'subject') {
          // Clear queued lesson topics when parent curriculum context changes.
          setLessonPlanSelectedSubStrands([]);
        }
      }
      return next;
    });
  }, [dispatch]);

  const preparePreviewSegments = useCallback((note) => {
    const segments = segmentHtmlWithImages(note?.content || '');
    const init = segments.map((s) => (s.type === 'image' ? { ...s, imgUrl: undefined } : s));
    setPreviewSegments(init);

    // Collect image fetch promises and update state once when all settle
    const imageJobs = init
      .map((seg, idx) => ({ seg, idx }))
      .filter(({ seg }) => seg.type === 'image');

    if (imageJobs.length === 0) return;

    Promise.allSettled(
      imageJobs.map(({ seg }) => {
        const query = seg.meta?.search_query || seg.meta?.title || '';
        return query ? fetchImageForQuery(query) : Promise.resolve('');
      })
    ).then((results) => {
      setPreviewSegments((prev) => {
        const next = [...prev];
        imageJobs.forEach(({ idx }, i) => {
          const url = results[i].status === 'fulfilled' ? results[i].value || '' : '';
          next[idx] = { ...next[idx], imgUrl: url };
        });
        return next;
      });
    });
  }, []);

  const displayNote = useCallback((note) => {
    if (!note) {
      setViewingNote(null);
      setPreviewSegments([]);
      return;
    }
    setViewingNote(note);
    preparePreviewSegments(note);
  }, [preparePreviewSegments]);

  const handleOpenDownloadMenu = useCallback((event) => {
    setDownloadMenuAnchorEl(event.currentTarget);
  }, []);

  const handleCloseDownloadMenu = useCallback(() => {
    setDownloadMenuAnchorEl(null);
  }, []);

  const handleOpenBulkDownloadMenu = useCallback((event) => {
    setBulkDownloadMenuAnchorEl(event.currentTarget);
  }, []);

  const handleCloseBulkDownloadMenu = useCallback(() => {
    setBulkDownloadMenuAnchorEl(null);
  }, []);

  const sanitizeDownloadBaseName = useCallback((name, fallback = 'download') => (
    String(name || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/(^-|-$)/g, '') || fallback
  ), []);

  const getLessonNoteName = useCallback((note) => {
    const subjectPart = note?.subStrand?.strand?.subject?.name || '';
    const weekPart = note?.generationContext?.week ? `Week ${note.generationContext.week}` : '';
    const nameParts = [subjectPart, weekPart].filter(Boolean);
    return nameParts.length > 0 ? nameParts.join(' - ') : (note?.subStrand?.name || 'lesson-note');
  }, []);

  const getDownloadErrorMessage = useCallback((error) => (
    error?.response?.data?.message || error?.message || 'Payment failed. Please try again.'
  ), []);

  const loadPaystackScript = useCallback(async () => {
    if (window.PaystackPop) return true;

    const existingScript = document.querySelector('script[data-paystack-inline="true"]');
    if (existingScript) {
      await new Promise((resolve, reject) => {
        existingScript.addEventListener('load', resolve, { once: true });
        existingScript.addEventListener('error', reject, { once: true });
      }).catch(() => false);
      return Boolean(window.PaystackPop);
    }

    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.setAttribute('data-paystack-inline', 'true');

    const loaded = await new Promise((resolve) => {
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

    return loaded && Boolean(window.PaystackPop);
  }, []);

  const processDownloadPayment = useCallback(async ({ itemType, itemId, format = 'pdf' }) => {
    setIsChargingDownload(true);

    try {
      const initResponse = await teacherService.initializeDownloadPayment({ itemType, itemId, format });

      if (initResponse?.alreadyPaid) {
        if (initResponse?.waived) {
          setSnackbar({
            open: true,
            message: 'Download fee waived by admin. Download will start now.',
            severity: 'info',
          });
        }
        return true;
      }

      const paystackConfig = initResponse?.paystack;

      if (!paystackConfig?.publicKey || !paystackConfig?.reference) {
        throw new Error('Payment gateway initialization failed.');
      }

      const scriptReady = await loadPaystackScript();
      if (!scriptReady) {
        throw new Error('Unable to load Paystack checkout.');
      }

      const referenceFromCheckout = await new Promise((resolve, reject) => {
        const handler = window.PaystackPop.setup({
          key: paystackConfig.publicKey,
          email: paystackConfig.email,
          amount: Math.round(Number(paystackConfig.amount || DOWNLOAD_FEE_GHS) * 100),
          currency: paystackConfig.currency || 'GHS',
          ref: paystackConfig.reference,
          metadata: {
            custom_fields: [
              { display_name: 'Purpose', variable_name: 'purpose', value: 'download' },
              { display_name: 'Item Type', variable_name: 'item_type', value: itemType },
            ],
          },
          callback: (response) => resolve(response?.reference || paystackConfig.reference),
          onClose: () => reject(new Error('Payment was cancelled.')),
        });

        handler.openIframe();
      });

      await teacherService.verifyDownloadPayment({ reference: referenceFromCheckout });
      return true;
    } catch (error) {
      setSnackbar({ open: true, message: getDownloadErrorMessage(error), severity: 'error' });
      return false;
    } finally {
      setIsChargingDownload(false);
    }
  }, [DOWNLOAD_FEE_GHS, getDownloadErrorMessage, loadPaystackScript]);

  const processBulkDownloadPayment = useCallback(async ({ itemType, itemIds, format = 'pdf' }) => {
    setIsChargingDownload(true);

    try {
      const initResponse = await teacherService.initializeBulkDownloadPayment({ itemType, itemIds, format });

      if (initResponse?.alreadyPaid) {
        if (initResponse?.waived) {
          setSnackbar({
            open: true,
            message: 'Download fee waived by admin. Bulk download will start now.',
            severity: 'info',
          });
        }
        return {
          ok: true,
          amount: Number(initResponse?.charge?.amount || 0),
        };
      }

      const paystackConfig = initResponse?.paystack;
      if (!paystackConfig?.publicKey || !paystackConfig?.reference) {
        throw new Error('Payment gateway initialization failed.');
      }

      const scriptReady = await loadPaystackScript();
      if (!scriptReady) {
        throw new Error('Unable to load Paystack checkout.');
      }

      const referenceFromCheckout = await new Promise((resolve, reject) => {
        const handler = window.PaystackPop.setup({
          key: paystackConfig.publicKey,
          email: paystackConfig.email,
          amount: Math.round(Number(paystackConfig.amount || 0) * 100),
          currency: paystackConfig.currency || 'GHS',
          ref: paystackConfig.reference,
          metadata: {
            custom_fields: [
              { display_name: 'Purpose', variable_name: 'purpose', value: 'bulk_download' },
              { display_name: 'Item Type', variable_name: 'item_type', value: itemType },
              { display_name: 'Item Count', variable_name: 'item_count', value: String((itemIds || []).length) },
            ],
          },
          callback: (response) => resolve(response?.reference || paystackConfig.reference),
          onClose: () => reject(new Error('Payment was cancelled.')),
        });

        handler.openIframe();
      });

      await teacherService.verifyBulkDownloadPayment({ reference: referenceFromCheckout });
      return {
        ok: true,
        amount: Number(paystackConfig.amount || 0),
      };
    } catch (error) {
      setSnackbar({ open: true, message: getDownloadErrorMessage(error), severity: 'error' });
      return { ok: false, amount: 0 };
    } finally {
      setIsChargingDownload(false);
    }
  }, [getDownloadErrorMessage, loadPaystackScript]);

  const createQuizHtml = useCallback((quiz) => {
    const mcqItems = Array.isArray(quiz?.mcq)
      ? quiz.mcq
      : (quiz?.questions || []).map((q) => ({
          question: q?.text || '',
          options: (q?.options || []).map((opt) => opt?.text || ''),
          correctIndex: (q?.options || []).findIndex((opt) => !!opt?.isCorrect),
        }));

    const section = (title, items, rowBuilder) => {
      if (!Array.isArray(items) || items.length === 0) return '';
      return `
        <h3>${title}</h3>
        <ol>
          ${items.map(rowBuilder).join('')}
        </ol>
      `;
    };

    return `
      <h2>${quiz?.title || 'Quiz'}</h2>
      ${section('Multiple Choice Questions', mcqItems, (q) => `
        <li>
          <p><strong>${q.question || ''}</strong></p>
          <ul>${(q.options || []).map((opt, idx) => `<li>${String.fromCharCode(65 + idx)}. ${opt}${idx === q.correctIndex ? ' (Correct)' : ''}</li>`).join('')}</ul>
        </li>
      `)}
      ${section('Short Answer', quiz?.shortAnswer, (q) => `
        <li>
          <p><strong>${q.question || ''}</strong></p>
          <p>Expected Answer: ${q.expectedAnswer || ''}</p>
        </li>
      `)}
      ${section('Essay', quiz?.essay, (q) => `
        <li>
          <p><strong>${q.question || ''}</strong></p>
          <p>Marking Guide: ${q.markingGuide || ''}</p>
        </li>
      `)}
    `;
  }, []);

  const exportHtmlContent = useCallback(async ({ title, htmlContent, format = 'pdf', fallback = 'download' }) => {
    if (!htmlContent) {
      return false;
    }

    const baseName = sanitizeDownloadBaseName(title, fallback);
    const elementId = `paid-download-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const tempDiv = document.createElement('div');
    tempDiv.id = elementId;
    tempDiv.innerHTML = htmlContent;
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = '820px';
    document.body.appendChild(tempDiv);

    try {
      if (format === 'pdf') {
        await downloadAsPdf(elementId, baseName, {});
      } else if (format === 'txt') {
        const tmp = document.createElement('div');
        tmp.innerHTML = htmlContent;
        const plainText = tmp.textContent || tmp.innerText || '';
        const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } else {
        const htmlDocument = `<!doctype html><html><head><meta charset="utf-8" /><title>${baseName}</title></head><body>${htmlContent}</body></html>`;
        const blobType = format === 'doc' ? 'application/msword;charset=utf-8' : 'text/html;charset=utf-8';
        const extension = format === 'doc' ? 'doc' : 'html';
        const blob = new Blob([htmlDocument], { type: blobType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }

      return true;
    } finally {
      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }
    }
  }, [sanitizeDownloadBaseName]);

  const chargeAndDownloadHtml = useCallback(async ({ itemType, itemId, title, htmlContent, format = 'pdf' }) => {
    if (!itemType || !itemId || !htmlContent) {
      setSnackbar({ open: true, message: 'Missing download details.', severity: 'error' });
      return false;
    }

    const paymentSuccessful = await processDownloadPayment({ itemType, itemId, format });
    if (!paymentSuccessful) {
      return false;
    }

    try {
      const exported = await exportHtmlContent({ title, htmlContent, format, fallback: itemType });
      if (!exported) {
        throw new Error('download failed');
      }

      setSnackbar({
        open: true,
        message: `Payment successful (GHC ${DOWNLOAD_FEE_GHS.toFixed(2)}). Download started.`,
        severity: 'success',
      });
      return true;
    } catch {
      setSnackbar({ open: true, message: 'Payment succeeded, but file download failed.', severity: 'warning' });
      return false;
    }
  }, [DOWNLOAD_FEE_GHS, exportHtmlContent, processDownloadPayment]);

  const handleBulkDownload = useCallback(async (format) => {
    if (!selectedNoteIds.size) return;

    const notes = lessonNotesBySelection.filter((n) => selectedNoteIds.has(n._id));
    let processedCount = 0;

    handleCloseBulkDownloadMenu();
    setIsBulkDownloading(true);

    try {
      const bulkPayment = await processBulkDownloadPayment({
        itemType: 'lesson_note',
        itemIds: notes.map((note) => note._id),
        format,
      });

      if (!bulkPayment.ok) {
        return;
      }

      for (const note of notes) {
        const completed = await exportHtmlContent({
          title: getLessonNoteName(note),
          htmlContent: note.content || '',
          format,
          fallback: 'lesson-note',
        });

        if (!completed) {
          break;
        }

        processedCount += 1;
        await new Promise((r) => setTimeout(r, 350));
      }

      if (processedCount > 0) {
        setSnackbar({
          open: true,
          message: `Payment successful (GHC ${Number(bulkPayment.amount || 0).toFixed(2)}). Downloaded ${processedCount} lesson note(s) as ${format.toUpperCase()}.`,
          severity: 'success',
        });
      }

      if (processedCount === notes.length) {
        setSelectedNoteIds(new Set());
      }
    } catch (_err) {
      setSnackbar({ open: true, message: 'Some downloads failed. Please try again.', severity: 'error' });
    } finally {
      setIsBulkDownloading(false);
    }
  }, [selectedNoteIds, lessonNotesBySelection, handleCloseBulkDownloadMenu, exportHtmlContent, getLessonNoteName, processBulkDownloadPayment]);

  const handleDownloadViewingNote = useCallback(async (format) => {
    if (!viewingNote) return;

    const paymentSuccessful = await processDownloadPayment({
      itemType: viewingNote?.teacher ? 'lesson_note' : 'learner_note',
      itemId: viewingNote?._id,
      format,
    });

    if (!paymentSuccessful) {
      handleCloseDownloadMenu();
      return;
    }

    const topic = getLessonNoteName(viewingNote);
    const safeFileName = sanitizeDownloadBaseName(topic, 'lesson-note');

    const printableBody = (previewSegments || []).map((segment) => {
      if (segment.type === 'text') return segment.html || '';
      if (segment.type === 'image' && segment.imgUrl) {
        const imageTitle = segment.meta?.title ? `<figcaption>${segment.meta.title}</figcaption>` : '';
        return `
          <figure style="margin: 16px 0; text-align: center;">
            <img src="${segment.imgUrl}" alt="${segment.meta?.title || ''}" style="max-width: 100%; height: auto;" />
            ${imageTitle}
          </figure>
        `;
      }
      return '';
    }).join('');

    const htmlDocument = `
      <!doctype html>
      <html>
        <head>
          <title>${topic}</title>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, sans-serif; color: #2E3A44; margin: 24px; line-height: 1.6; }
            h2, h3 { margin-top: 20px; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            td, th { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          ${printableBody}
        </body>
      </html>
    `;

    if (format === 'pdf') {
      const previewElement = document.getElementById('teacher-note-preview-content');
      if (!previewElement) {
        handleCloseDownloadMenu();
        setSnackbar({ open: true, message: 'PDF export is not available right now.', severity: 'error' });
        return;
      }

      setIsPdfExporting(true);
      handleCloseDownloadMenu();

      // Ensure the screenshot starts from top of the preview content.
      const scrollHost = previewElement.closest('.MuiDialogContent-root');
      if (scrollHost) scrollHost.scrollTop = 0;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const pdfTask = downloadAsPdf('teacher-note-preview-content', safeFileName || 'lesson-note', {
            margin: [2.5, 1, 2.5, 1],
            html2canvas: {
              scale: 1.6,
              useCORS: true,
              scrollX: 0,
              scrollY: 0,
            },
            pagebreak: {
              mode: ['css', 'legacy'],
              avoid: ['img', 'figure'],
            },
          });

          Promise.resolve(pdfTask)
            .then(() => {
              setSnackbar({
                open: true,
                message: `Payment successful (GHC ${DOWNLOAD_FEE_GHS.toFixed(2)}). Downloaded as .pdf`,
                severity: 'success',
              });
            })
            .catch(() => {
              setSnackbar({ open: true, message: 'Failed to generate PDF.', severity: 'error' });
            })
            .finally(() => {
              setIsPdfExporting(false);
            });
        });
      });

      return;
    }

    let blob;
    let extension;

    if (format === 'html') {
      blob = new Blob([htmlDocument], { type: 'text/html;charset=utf-8' });
      extension = 'html';
    } else if (format === 'doc') {
      blob = new Blob([htmlDocument], { type: 'application/msword' });
      extension = 'doc';
    } else {
      const tmp = document.createElement('div');
      tmp.innerHTML = printableBody;
      const plainText = tmp.textContent || tmp.innerText || '';
      blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
      extension = 'txt';
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName || 'lesson-note'}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    handleCloseDownloadMenu();
    setSnackbar({
      open: true,
      message: `Payment successful (GHC ${DOWNLOAD_FEE_GHS.toFixed(2)}). Downloaded as .${extension}`,
      severity: 'success',
    });
  }, [DOWNLOAD_FEE_GHS, getLessonNoteName, handleCloseDownloadMenu, previewSegments, processDownloadPayment, sanitizeDownloadBaseName, setSnackbar, viewingNote]);

  const handleGenerateNoteSubmit = useCallback((formData) => {
    const selectedTopics = lessonPlanSelectedSubStrands.length > 0
      ? lessonPlanSelectedSubStrands
      : (selections.subStrand
        ? [{ id: selections.subStrand, name: subStrands.find((s) => s._id === selections.subStrand)?.name || 'Topic' }]
        : []);

    if (selectedTopics.length === 0) {
      setSnackbar({ open: true, message: 'Select at least one sub-strand to generate lesson notes.', severity: 'warning' });
      return;
    }

    (async () => {
      try {
        const requestPayloads = Array.isArray(formData.requests) && formData.requests.length > 0
          ? formData.requests
          : [formData];

        // Ping the server first to wake it from cold-start before sending heavy AI requests
        if (requestPayloads.length > 1) {
          await teacherService.wakeUpServer();
        }

        const createdNotes = [];
        const failedWeeks = [];

        for (let i = 0; i < requestPayloads.length; i += 1) {
          const requestPayload = requestPayloads[i];
          const resolvedSubStrandIds = Array.isArray(requestPayload.subStrandIds) && requestPayload.subStrandIds.length > 0
            ? requestPayload.subStrandIds
            : selectedTopics.map((topic) => topic.id);

          try {
            const createdNote = await dispatch(generateLessonNote({
              ...requestPayload,
              subStrandIds: resolvedSubStrandIds,
              subStrandId: requestPayload.subStrandId || resolvedSubStrandIds[0] || selectedTopics[0]?.id,
            })).unwrap();
            createdNotes.push(createdNote);
          } catch (weekErr) {
            const weekNum = requestPayload.week || (i + 1);
            failedWeeks.push(weekNum);
          }

          // Small delay between requests to avoid overwhelming the server
          if (i < requestPayloads.length - 1) {
            await new Promise((resolve) => { setTimeout(resolve, 1200); });
          }
        }

        if (createdNotes.length === 0) {
          const weekList = failedWeeks.length > 0 ? ` (Week${failedWeeks.length > 1 ? 's' : ''} ${failedWeeks.join(', ')})` : '';
          setSnackbar({
            open: true,
            message: `Failed to generate lesson notes${weekList}. The AI service may be unavailable — please try again in a moment.`,
            severity: 'error',
          });
          return;
        }

        const generatedCount = createdNotes.length;
        const totalCount = requestPayloads.length;
        let successMessage;
        if (generatedCount === totalCount) {
          successMessage = generatedCount > 1
            ? `${generatedCount} lesson notes generated for the selected week range.`
            : (selectedTopics.length === 1
              ? 'Lesson note generated!'
              : 'One combined lesson note generated for all selected topics.');
        } else {
          successMessage = `${generatedCount} of ${totalCount} notes generated. Week${failedWeeks.length > 1 ? 's' : ''} ${failedWeeks.join(', ')} failed — you can retry those individually.`;
        }

        const severity = failedWeeks.length > 0 ? 'warning' : 'success';
        setSnackbar({ open: true, message: successMessage, severity });
        displayNote(createdNotes[createdNotes.length - 1]);
        closeDialog();
        setShowCreateTools(false);
        setLessonPlanSelectedSubStrands([]);
      } catch (_err) {
        setSnackbar({
          open: true,
          message: 'An unexpected error occurred. Please try again.',
          severity: 'error',
        });
      }
    })();
  }, [dispatch, displayNote, closeDialog, lessonPlanSelectedSubStrands, selections.subStrand, subStrands]);

  // quiz-from-lesson flow
  const handleGenerateQuizFromLesson = useCallback(() => {
    if (!selectedLessonForQuiz) return;
    const note = (lessonNotes || []).find(n => n._id === selectedLessonForQuiz);
    const topic = note?.subStrand?.name || note?.title || 'Topic';
    const subjectName = note?.subStrand?.strand?.subject?.name || '';
    const className = note?.subStrand?.strand?.subject?.class?.name || '';

    if (!subjectName || !className) {
      setSnackbar({
        open: true,
        message: 'Selected lesson note lacks curriculum metadata (subject/class). Open or regenerate the note and try again.',
        severity: 'error',
      });
      return;
    }
    const subjectId = note?.subStrand?.strand?.subject?._id || '';
    if (!subjectId) {
      setSnackbar({
        open: true,
        message: 'Unable to determine subject id for selected lesson note.',
        severity: 'error',
      });
      return;
    }

    dispatch(generateAiQuiz({
      topic,
      subjectName,
      className,
      subjectId,
      subStrandId: note?.subStrand?._id || note?.subStrand,
      numQuestions: 10,
    }))
      .unwrap()
      .then(() => {
        setSnackbar({ open: true, message: 'Quiz generated from lesson note!', severity: 'success' });
        closeDialog();
        setSelectedLessonForQuiz('');
      })
      .catch((err) => setSnackbar({ open: true, message: err || 'Failed', severity: 'error' }));
  }, [dispatch, selectedLessonForQuiz, lessonNotes, closeDialog]);

  // quiz-from-strands flow
  const handleGenerateQuizFromStrands = useCallback(() => {
    if (quizSelectedSubStrands.length === 0) return;
    // generate one quiz per selected sub-strand
    Promise.all(
      quizSelectedSubStrands.map((id) => {
        const sub = subStrands.find(s => s._id === id);
        const topic = sub?.name || 'Topic';
        const subjectName = sub?.strand?.subject?.name || '';
      const className = sub?.strand?.subject?.class?.name || '';
      const subjectId = sub?.strand?.subject?._id || '';
      if (!subjectName || !className || !subjectId) {
        // should be rare because subStrands are fully populated, but guard anyway
        return Promise.reject('Curriculum data missing for selected strand');
      }
      return dispatch(generateAiQuiz({
          topic,
          subjectName,
          className,
          subjectId,
          subStrandId: id,
          numQuestions: 10,
        }));
      })
    ).then(() => {
      setSnackbar({ open: true, message: 'Quizzes generated for selected strands!', severity: 'success' });
      closeDialog();
      setQuizSelectedSubStrands([]);
    }).catch((err) => setSnackbar({ open: true, message: err || 'Failed', severity: 'error' }));
  }, [dispatch, quizSelectedSubStrands, subStrands, closeDialog]);

  const handleGenerateBundleSubmit = useCallback((data) => {
    dispatch(generateLessonBundle(data)).unwrap().then(() => {
      closeDialog();
      setActiveDialog('bundleResult');
      setSnackbar({ open: true, message: 'Lesson bundle generated! 🎉', severity: 'success' });
      setShowCreateTools(false);
    }).catch((error) => setSnackbar({ open: true, message: error || 'Failed', severity: 'error' }));
  }, [dispatch, closeDialog]);

  // form input change for strand dialog
  const handleStrandFormChange = useCallback((e) => {
    const { name, value } = e.target;
    setStrandForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const closeLearnerFromStrand = useCallback(() => {
    closeDialog();
    resetSelections();
    resetStrandForm();
  }, [closeDialog, resetSelections, resetStrandForm]);

  // dispatch generator for learner note from strand
  const handleGenerateLearnerFromStrand = useCallback(() => {
    if (!selections.subStrand) return;
    const payload = {
      subStrandId: selections.subStrand,
      school: user?.school || '',
      term: strandForm.term,
      week: strandForm.week,
      dayDate: strandForm.dayDate,
      duration: strandForm.duration,
      classSize: strandForm.classSize,
      contentStandardCode: strandForm.contentStandardCode,
      indicatorCodes: strandForm.indicatorCodes,
      reference: strandForm.reference,
      preferredProvider: strandForm.preferredProvider,
      preferredModel: strandForm.preferredModel,
    };
    dispatch(generateLearnerNoteFromStrand(payload))
      .unwrap()
      .then((created) => {
        setSnackbar({ open: true, message: 'Learner note generated (draft)!', severity: 'success' });
        displayNote(created);
        closeDialog();
        // reset selections and form
        resetSelections();
        resetStrandForm();
        dispatch(getDraftLearnerNotes());
      })
      .catch((err) => {
        setSnackbar({ open: true, message: err || 'Failed to generate learner note', severity: 'error' });
      });
  }, [dispatch, selections.subStrand, strandForm, user, displayNote, closeDialog, resetSelections, resetStrandForm]);

  // Generate only lesson plan (first part of bundle)
  const handleGeneratePlan = useCallback(() => {
    if (lessonPlanSelectedSubStrands.length === 0) return;
    // close selection and open lesson note form for user completion
    closeDialog();
    setActiveDialog('noteForm');
  }, [lessonPlanSelectedSubStrands.length, closeDialog]);

  const handlePublishBundle = useCallback((bundle) => {
    if (bundle.learnerNote?.id) {
      dispatch(publishLearnerNote(bundle.learnerNote.id));
    }
    closeDialog();
    setSnackbar({ open: true, message: 'Bundle published! ✨', severity: 'success' });
    dispatch(getMyLessonNotes());
    dispatch(getDraftLearnerNotes());
  }, [dispatch, closeDialog]);

  const handlePublishLearnerNote = useCallback((noteId) => {
    dispatch(publishLearnerNote(noteId))
      .unwrap()
      .then(() => {
        if (viewingNote?._id === noteId) displayNote(null);
        setSnackbar({ open: true, message: 'Learner note published to students.', severity: 'success' });
      })
      .catch((err) => {
        setSnackbar({ open: true, message: err || 'Failed to publish learner note.', severity: 'error' });
      });
  }, [dispatch, viewingNote, displayNote]);

  const handleGenerateLearnerFromLesson = useCallback(() => {
    if (!selectedLessonForLearner) return;
    dispatch(generateLearnerNote(selectedLessonForLearner))
      .unwrap()
      .then((created) => {
        setSnackbar({ open: true, message: 'Learner note generated (draft)!', severity: 'success' });
        displayNote(created);
        closeDialog();
        setSelectedLessonForLearner('');
        dispatch(getDraftLearnerNotes());
      })
      .catch((err) => {
        setSnackbar({ open: true, message: err || 'Failed to generate learner note', severity: 'error' });
      });
  }, [dispatch, selectedLessonForLearner, displayNote, closeDialog]);

  const handleViewQuiz = useCallback((quizId) => {
    dispatch(getQuizById(quizId))
      .unwrap()
      .then(() => setActiveDialog('quizView'))
      .catch((err) => setSnackbar({ open: true, message: err || 'Failed to load quiz', severity: 'error' }));
  }, [dispatch]);

  const handleDownloadCurrentQuiz = useCallback(async () => {
    if (!currentQuiz?._id) return;

    await chargeAndDownloadHtml({
      itemType: 'quiz',
      itemId: currentQuiz._id,
      title: currentQuiz.title || 'quiz',
      htmlContent: createQuizHtml(currentQuiz),
      format: 'pdf',
    });
  }, [chargeAndDownloadHtml, createQuizHtml, currentQuiz]);

  const handleDeleteQuiz = useCallback((quizId) => {
    dispatch(deleteQuiz(quizId))
      .then(() => setSnackbar({ open: true, message: 'Quiz deleted!', severity: 'success' }))
      .catch((err) => setSnackbar({ open: true, message: err || 'Failed to delete quiz', severity: 'error' }));
  }, [dispatch]);

  const handleDeleteLessonNote = useCallback(() => {
    if (!noteToDelete?._id) return;
    dispatch(deleteLessonNote(noteToDelete._id))
      .unwrap()
      .then(() => {
        if (viewingNote?._id === noteToDelete._id) displayNote(null);
        setSnackbar({ open: true, message: 'Lesson note deleted.', severity: 'success' });
      })
      .catch((err) => setSnackbar({ open: true, message: err || 'Failed to delete lesson note.', severity: 'error' }))
      .finally(() => setNoteToDelete(null));
  }, [dispatch, noteToDelete, viewingNote, displayNote]);

  const handleDeleteLearnerNote = useCallback(() => {
    if (!learnerNoteToDelete?._id) return;
    dispatch(deleteDraftLearnerNote(learnerNoteToDelete._id))
      .unwrap()
      .then(() => {
        if (viewingNote?._id === learnerNoteToDelete._id) displayNote(null);
        setSnackbar({ open: true, message: 'Learner note deleted.', severity: 'success' });
      })
      .catch((err) => setSnackbar({ open: true, message: err || 'Failed to delete learner note.', severity: 'error' }))
      .finally(() => setLearnerNoteToDelete(null));
  }, [dispatch, learnerNoteToDelete, viewingNote, displayNote]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      dispatch(getMyLessonNotes()),
      dispatch(getDraftLearnerNotes()),
      dispatch(getTeacherAnalytics()),
      dispatch(getMyBundles())
    ]);
    setTimeout(() => setRefreshing(false), 1000);
  }, [dispatch]);

  const createNewToolItems = [
    {
      key: 'lesson-plan',
      label: 'Generate Lesson Plan',
      imageUrl: 'https://static.vecteezy.com/system/resources/previews/027/685/568/original/teacher-lesson-icon-flat-vector.jpg',
      onClick: () => {
        resetSelections();
        setLessonPlanSelectedSubStrands([]);
        setActiveDialog('plan');
      },
    },
    {
      key: 'learner-notes',
      label: 'Generate Learner Notes',
      imageUrl: 'https://cdn-icons-png.flaticon.com/512/8980/8980099.png',
      onClick: () => {
        resetSelections();
        setActiveDialog('learnerOptions');
      },
    },
    {
      key: 'quiz',
      label: 'Generate Quiz',
      imageUrl: 'https://static.vecteezy.com/system/resources/previews/009/742/591/large_2x/quiz-game-icon-outline-illustration-vector.jpg',
      onClick: () => setActiveDialog('quizOptions'),
    },
    {
      key: 'bundle',
      label: 'Generate Complete Lesson Bundle',
      imageUrl: 'https://img.freepik.com/premium-vector/color-school-tools-icon_24640-20330.jpg?w=2000',
      onClick: () => {
        resetSelections();
        setActiveDialog('bundleSelector');
      },
    },
  ];

  const managementToolItems = [
    {
      key: 'create-new',
      label: 'Create New',
      imageUrl: 'https://static.vecteezy.com/system/resources/previews/015/526/676/original/presentation-creative-icon-design-free-vector.jpg',
      onClick: () => setShowCreateTools(true),
    },
    {
      key: 'my-lesson-notes',
      label: 'My Lesson Notes',
      imageUrl: 'https://i.pinimg.com/736x/d1/f0/68/d1f068f076dd1d2090b35d602f62948f.jpg',
      onClick: () => {
        setNotesClassFilter('');
        setNotesSubjectFilter('');
        setActiveDialog('myLessonNotes');
      },
    },
    {
      key: 'my-learner-notes',
      label: 'Learner Notes',
      imageUrl: 'https://media.istockphoto.com/id/1408391194/vector/reader-reciter.jpg?s=612x612&w=0&k=20&c=DpvhTP2hQqv_XrORtg56zz61WiFalK44CPO_Ka67ozg=',
      onClick: () => {
        setLearnerNotesClassFilter('');
        setLearnerNotesSubjectFilter('');
        setActiveDialog('myLearnerNotes');
      },
    },
    {
      key: 'my-quizzes',
      label: 'Quizzes',
      imageUrl: 'https://img.freepik.com/premium-vector/quiz-logo-poll-questionnaire-icon-symbol_101884-1076.jpg?w=2000',
      onClick: () => setActiveDialog('myQuizzes'),
    },
    {
      key: 'analysis',
      label: 'Analysis',
      imageUrl: 'https://png.pngtree.com/png-vector/20191009/ourlarge/pngtree-analysis-icon-png-image_1798051.jpg',
      onClick: () => setActiveDialog('analytics'),
    },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f5' }}>
      <Box sx={{ maxWidth: '1200px', mx: 'auto', p: { xs: 2, md: 4 } }}>
        
        {/* Header Banner */}
        <DashboardBanner
          user={user}
          role="teacher"
          stats={[]}
          primaryAction={{
            label: 'Create New',
            onClick: () => setShowCreateTools(true),
          }}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          collapsed={bannerCollapsed}
          onCollapse={setBannerCollapsed}
        />

        {/* OVERVIEW SECTION */}
        <Box sx={{ mt: 4, mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, color: 'text.primary', letterSpacing: 0.2 }}>
            Overview
          </Typography>
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            {overviewCards.map((card) => (
              <Grid key={card.key} item xs={6} md={3}>
                <Paper
                  sx={(theme) => ({
                    ...overviewCardSx,
                    borderColor: alpha(theme.palette[card.palette].main, 0.2),
                    background: alpha(theme.palette[card.palette].main, 0.12),
                    boxShadow: `0 10px 24px ${alpha(theme.palette[card.palette].main, 0.18)}`,
                  })}
                >
                  <Box
                    sx={(theme) => ({
                      width: { xs: 34, sm: 38 },
                      height: { xs: 34, sm: 38 },
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: theme.palette[card.palette].main,
                      color: theme.palette[card.palette].contrastText,
                      boxShadow: `0 8px 16px ${alpha(theme.palette[card.palette].main, 0.35)}`,
                      mb: { xs: 1.2, sm: 2 },
                    })}
                  >
                    <card.Icon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  </Box>
                  <Typography variant="h3" sx={(theme) => ({ fontWeight: 800, lineHeight: 1, mb: { xs: 0.6, sm: 1.1 }, color: theme.palette[card.palette].main, fontSize: { xs: '1.35rem', sm: '3rem' } })}>
                    {card.value}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: { xs: 0.2, sm: 0.6 }, color: 'text.primary', display: 'block', fontSize: { xs: '0.62rem', sm: '0.75rem' } }}>
                    {card.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                    {card.subtitle}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Box>

        {/* Divider */}
        <Divider sx={{ my: 4, borderColor: 'divider' }} />

        {/* TEACHER TOOLS SECTION */}
        {showCreateTools ? (
          <Box sx={{ mt: 4, mb: 3 }}>
            <Button onClick={() => setShowCreateTools(false)} variant="text" sx={{ mb: 2 }}>← Back</Button>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 3, color: 'text.primary', letterSpacing: 0.2 }}>Create New</Typography>
            <Grid container spacing={{ xs: 1.5, sm: 3 }}>
              {createNewToolItems.map((tool) => (
                <ToolTile
                  key={tool.key}
                  label={tool.label}
                  imageUrl={tool.imageUrl}
                  onClick={tool.onClick}
                  toolTileSx={toolTileSx}
                  toolImageSx={toolImageSx}
                />
              ))}
            </Grid>
          </Box>
        ) : (
          <Box sx={{ mt: 4, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 3, color: 'text.primary', letterSpacing: 0.2 }}>TEACHER TOOLS</Typography>
            <Grid container spacing={{ xs: 1.5, sm: 3 }}>
              {managementToolItems.map((tool) => (
                <ToolTile
                  key={tool.key}
                  label={tool.label}
                  imageUrl={tool.imageUrl}
                  onClick={tool.onClick}
                  toolTileSx={toolTileSx}
                  toolImageSx={toolImageSx}
                />
              ))}
            </Grid>
          </Box>
        )}

        {/* Modals & Dialogs */}
        {/* Plan generation modal */}
        <Dialog open={activeDialog === 'plan'} onClose={() => closeDialog()} fullScreen={isDialogFullscreen('plan')} fullWidth maxWidth={isDialogFullscreen('plan') ? false : 'sm'}>
          <DialogTitleWithFullscreen title="Select Topics for Lesson Plan" isFullscreen={isDialogFullscreen('plan')} onToggle={() => toggleDialogFullscreen('plan')} />
          <DialogContent>
            <CurriculumSelection
              levels={levels}
              classes={classes}
              subjects={subjects}
              strands={strands}
              subStrands={subStrands}
              selections={selections}
              handleSelectionChange={handleSelectionChange}
              isLoading={isLoading || planLoading}
            />

            {subStrands.length > 0 && (
              <Paper sx={{ mt: 2, maxHeight: 280, overflow: 'auto', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <List>
                  {subStrands.map((s) => {
                    const isChecked = lessonPlanSelectedSubStrands.some((item) => item.id === s._id);
                    return (
                      <ListItem key={s._id} disablePadding>
                        <ListItemButton
                          onClick={() => {
                            setLessonPlanSelectedSubStrands((prev) => {
                              if (prev.some((item) => item.id === s._id)) {
                                return prev.filter((item) => item.id !== s._id);
                              }
                              return [
                                ...prev,
                                {
                                  id: s._id,
                                  name: s.name,
                                  strandName: s?.strand?.name || (strands.find((strandItem) => strandItem._id === selections.strand)?.name || ''),
                                },
                              ];
                            });
                          }}
                          sx={selectableListItemSx}
                        >
                          <ListItemText
                            primary={s.name}
                            secondary={s?.strand?.name ? `Strand: ${s.strand.name}` : undefined}
                          />
                          <Checkbox edge="end" checked={isChecked} />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </Paper>
            )}

            {lessonPlanSelectedSubStrands.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                  Selected Sub-Strands ({lessonPlanSelectedSubStrands.length})
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {lessonPlanSelectedSubStrands.map((topic) => (
                    <Chip
                      key={topic.id}
                      label={topic.strandName ? `${topic.strandName} - ${topic.name}` : topic.name}
                      onDelete={() => {
                        setLessonPlanSelectedSubStrands((prev) => prev.filter((item) => item.id !== topic.id));
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeDialog()} disabled={planLoading}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleGeneratePlan}
              disabled={lessonPlanSelectedSubStrands.length === 0 || planLoading}
              startIcon={planLoading ? <CircularProgress size={20} /> : null}
            >
              {planLoading
                ? 'Generating...'
                : `Continue (${lessonPlanSelectedSubStrands.length} Topic${lessonPlanSelectedSubStrands.length === 1 ? '' : 's'})`}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Bundle topic selector dialog */}
        <Dialog open={activeDialog === 'bundleSelector'} onClose={() => closeDialog()} fullScreen={isDialogFullscreen('bundleSelector')} fullWidth maxWidth={isDialogFullscreen('bundleSelector') ? false : 'sm'}>
          <DialogTitleWithFullscreen title="Select Topic for Lesson Bundle" isFullscreen={isDialogFullscreen('bundleSelector')} onToggle={() => toggleDialogFullscreen('bundleSelector')} />
          <DialogContent>
            <CurriculumSelection
              levels={levels}
              classes={classes}
              subjects={subjects}
              strands={strands}
              subStrands={subStrands}
              selections={selections}
              handleSelectionChange={handleSelectionChange}
              isLoading={isLoading}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeDialog()}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => {
                closeDialog();
                setActiveDialog('bundleModal');
              }}
              disabled={!selections.subStrand}
            >
              Continue
            </Button>
          </DialogActions>
        </Dialog>

        <LessonBundleForm
          open={activeDialog === 'bundleModal'}
          onClose={() => closeDialog()}
          onSubmit={handleGenerateBundleSubmit}
          subStrandName={subStrands.find((s) => s._id === selections.subStrand)?.name || ''}
          subStrandId={selections.subStrand}
          defaultFacilitatorName={user?.name || ''}
          defaultSchoolName={user?.school || ''}
          schoolCalendar={schoolCalendar}
          isLoading={isLoading}
        />
        {/* Learner Notes Options Dialog */}
        <Dialog open={activeDialog === 'learnerOptions'} onClose={() => closeDialog()} fullScreen={isDialogFullscreen('learnerOptions')} fullWidth maxWidth={isDialogFullscreen('learnerOptions') ? false : 'xs'}>
          <DialogTitleWithFullscreen title="Generate Learner Notes" isFullscreen={isDialogFullscreen('learnerOptions')} onToggle={() => toggleDialogFullscreen('learnerOptions')} />
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>Choose how you want to generate learner notes:</Typography>
            <Stack spacing={2}>
              <Button variant="outlined" onClick={() => { setActiveDialog('learnerFromLesson'); }}>
                From Lesson Note
              </Button>
              <Button variant="contained" onClick={() => { closeDialog(); resetSelections(); resetStrandForm(); setActiveDialog('learnerFromStrand'); }}>
                From Strands
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeDialog()}>Cancel</Button>
          </DialogActions>
        </Dialog>

        {/* Quiz Options Dialog */}
        <Dialog open={activeDialog === 'quizOptions'} onClose={() => closeDialog()} fullScreen={isDialogFullscreen('quizOptions')} fullWidth maxWidth={isDialogFullscreen('quizOptions') ? false : 'xs'}>
          <DialogTitleWithFullscreen title="Generate Quiz" isFullscreen={isDialogFullscreen('quizOptions')} onToggle={() => toggleDialogFullscreen('quizOptions')} />
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>Choose how you want to generate the quiz:</Typography>
            <Stack spacing={2}>
              <Button variant="outlined" onClick={() => { setActiveDialog('quizFromLesson'); }}>
                From Lesson Note
              </Button>
              <Button variant="contained" onClick={() => { closeDialog(); resetSelections(); setQuizSelectedSubStrands([]); setActiveDialog('quizFromStrand'); }}>
                From Strands
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeDialog()}>Cancel</Button>
          </DialogActions>
        </Dialog>

        {/* My Lesson Notes flow */}
        <Dialog
          open={activeDialog === 'myLessonNotes'}
          onClose={() => {
            closeDialog();
            setNotesClassFilter('');
            setNotesSubjectFilter('');
            setSelectedNoteIds(new Set());
          }}
          fullScreen={isDialogFullscreen('myLessonNotes')}
          fullWidth
          maxWidth={isDialogFullscreen('myLessonNotes') ? false : 'md'}
        >
          <DialogTitleWithFullscreen title="My Lesson Notes" isFullscreen={isDialogFullscreen('myLessonNotes')} onToggle={() => toggleDialogFullscreen('myLessonNotes')} />
          <DialogContent sx={dialogBodySx}>
            <Grid container spacing={2} sx={dialogFilterPanelSx}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel id="notes-class-label">Class</InputLabel>
                  <Select
                    labelId="notes-class-label"
                    label="Class"
                    value={notesClassFilter}
                    onChange={(event) => {
                      setNotesClassFilter(event.target.value);
                      setNotesSubjectFilter('');
                      setSelectedNoteIds(new Set());
                    }}
                  >
                    {lessonNoteClassOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small" disabled={!notesClassFilter}>
                  <InputLabel id="notes-subject-label">Subject</InputLabel>
                  <Select
                    labelId="notes-subject-label"
                    label="Subject"
                    value={notesSubjectFilter}
                    onChange={(event) => { setNotesSubjectFilter(event.target.value); setSelectedNoteIds(new Set()); }}
                  >
                    {lessonNoteSubjectOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {!notesClassFilter ? (
              <Typography variant="body2" color="text.secondary">Select a class to continue.</Typography>
            ) : !notesSubjectFilter ? (
              <Typography variant="body2" color="text.secondary">Select a subject to view notes.</Typography>
            ) : lessonNotesBySelection.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No lesson notes found for this class and subject.</Typography>
            ) : (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Checkbox
                      size="small"
                      checked={selectedNoteIds.size === lessonNotesBySelection.length}
                      indeterminate={selectedNoteIds.size > 0 && selectedNoteIds.size < lessonNotesBySelection.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedNoteIds(new Set(lessonNotesBySelection.map((n) => n._id)));
                        } else {
                          setSelectedNoteIds(new Set());
                        }
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {selectedNoteIds.size > 0 ? `${selectedNoteIds.size} selected` : 'Select all'}
                    </Typography>
                  </Box>
                  {selectedNoteIds.size > 0 && (
                    <>
                      <Button
                        variant="contained"
                        size="small"
                        disabled={isBulkDownloading || isChargingDownload}
                        onClick={handleOpenBulkDownloadMenu}
                        startIcon={isBulkDownloading ? <CircularProgress size={14} color="inherit" /> : <Download />}
                        endIcon={!isBulkDownloading ? <ExpandMore /> : null}
                      >
                        {isBulkDownloading
                          ? 'Processing downloads...'
                          : `Download ${selectedNoteIds.size} note${selectedNoteIds.size > 1 ? 's' : ''}`}
                      </Button>
                      <Menu
                        anchorEl={bulkDownloadMenuAnchorEl}
                        open={Boolean(bulkDownloadMenuAnchorEl)}
                        onClose={handleCloseBulkDownloadMenu}
                      >
                        <MenuItem onClick={() => handleBulkDownload('pdf')}>Download as PDF (.pdf)</MenuItem>
                        <MenuItem onClick={() => handleBulkDownload('html')}>Download as HTML (.html)</MenuItem>
                        <MenuItem onClick={() => handleBulkDownload('doc')}>Download as Word (.doc)</MenuItem>
                        <MenuItem onClick={() => handleBulkDownload('txt')}>Download as Text (.txt)</MenuItem>
                      </Menu>
                    </>
                  )}
                </Box>
                <List>
                  {lessonNotesBySelection.map((note) => (
                    <Paper key={note._id} sx={dialogListCardSx}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Checkbox
                            size="small"
                            checked={selectedNoteIds.has(note._id)}
                            onChange={(e) => {
                              setSelectedNoteIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(note._id);
                                else next.delete(note._id);
                                return next;
                              });
                            }}
                          />
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              {getLessonNoteName(note)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Created: {note.createdAt ? new Date(note.createdAt).toLocaleString() : 'Unknown'}
                            </Typography>
                          </Box>
                        </Box>
                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => {
                              displayNote(note);
                              closeDialog();
                            }}
                          >
                            Open
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            onClick={() => setNoteToDelete(note)}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </Box>
                    </Paper>
                  ))}
                </List>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                closeDialog();
                setNotesClassFilter('');
                setNotesSubjectFilter('');
                setSelectedNoteIds(new Set());
              }}
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>

        {/* My Learner Notes flow */}
        <Dialog
          open={activeDialog === 'myLearnerNotes'}
          onClose={() => {
            closeDialog();
            setLearnerNotesClassFilter('');
            setLearnerNotesSubjectFilter('');
          }}
          fullScreen={isDialogFullscreen('myLearnerNotes')}
          scroll="paper"
          fullWidth
          maxWidth={isDialogFullscreen('myLearnerNotes') ? false : 'md'}
        >
          <DialogTitleWithFullscreen title="My Learner Notes" isFullscreen={isDialogFullscreen('myLearnerNotes')} onToggle={() => toggleDialogFullscreen('myLearnerNotes')} />
          <DialogContent tabIndex={0} {...quizProtectionProps} sx={{ ...dialogBodySx, ...quizProtectionSx }}>
            <Grid container spacing={2} sx={dialogFilterPanelSx}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel id="learner-notes-class-label">Class</InputLabel>
                  <Select
                    labelId="learner-notes-class-label"
                    label="Class"
                    value={learnerNotesClassFilter}
                    onChange={(event) => {
                      setLearnerNotesClassFilter(event.target.value);
                      setLearnerNotesSubjectFilter('');
                    }}
                  >
                    {learnerNoteClassOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small" disabled={!learnerNotesClassFilter}>
                  <InputLabel id="learner-notes-subject-label">Subject</InputLabel>
                  <Select
                    labelId="learner-notes-subject-label"
                    label="Subject"
                    value={learnerNotesSubjectFilter}
                    onChange={(event) => setLearnerNotesSubjectFilter(event.target.value)}
                  >
                    {learnerNoteSubjectOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {!learnerNotesClassFilter ? (
              <Typography variant="body2" color="text.secondary">Select a class to continue.</Typography>
            ) : !learnerNotesSubjectFilter ? (
              <Typography variant="body2" color="text.secondary">Select a subject to view learner notes.</Typography>
            ) : learnerNotesBySelection.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No learner notes found for this class and subject.</Typography>
            ) : (
              <List>
                {learnerNotesBySelection.map((note) => (
                  <Paper key={note._id} sx={dialogListCardSx}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {note.subStrand?.name || 'Learner Note'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Created: {note.createdAt ? new Date(note.createdAt).toLocaleString() : 'Unknown'}
                        </Typography>
                        {note.status === 'published' && (
                          <Chip
                            label="Published"
                            size="small"
                            color="success"
                            sx={{ ml: 1, height: 20, fontWeight: 700 }}
                          />
                        )}
                      </Box>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            displayNote(note);
                            closeDialog();
                          }}
                        >
                          Open
                        </Button>
                        <Button
                          variant="contained"
                          size="small"
                          disabled={note.status === 'published'}
                          onClick={() => handlePublishLearnerNote(note._id)}
                        >
                          {note.status === 'published' ? 'Published' : 'Publish'}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => setLearnerNoteToDelete(note)}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </Box>
                  </Paper>
                ))}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                closeDialog();
                setLearnerNotesClassFilter('');
                setLearnerNotesSubjectFilter('');
              }}
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>

        {/* From Lesson Note flow */}
        <LessonNotePickerDialog
          open={activeDialog === 'learnerFromLesson'}
          onClose={() => { closeDialog(); setSelectedLessonForLearner(''); }}
          title="Generate Learner Note from an Existing Lesson Note"
          description="Select a lesson note to convert into a learner-friendly note."
          lessonNotes={lessonNotes}
          selectedId={selectedLessonForLearner}
          onSelect={setSelectedLessonForLearner}
          onConfirm={handleGenerateLearnerFromLesson}
          confirmLabel="Generate Learner Note"
          isLoading={isLoading}
          fullScreen={isDialogFullscreen('learnerFromLesson')}
          onToggleFullscreen={() => toggleDialogFullscreen('learnerFromLesson')}
        />

        {/* From Strands flow */}
        <Dialog open={activeDialog === 'learnerFromStrand'} onClose={closeLearnerFromStrand} fullScreen={isDialogFullscreen('learnerFromStrand')} scroll="paper" fullWidth maxWidth={isDialogFullscreen('learnerFromStrand') ? false : 'sm'}>
          <DialogTitleWithFullscreen title="Generate Learner Note from Strand" isFullscreen={isDialogFullscreen('learnerFromStrand')} onToggle={() => toggleDialogFullscreen('learnerFromStrand')} />
          <DialogContent tabIndex={0} sx={dialogBodySx}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Choose a strand/sub-strand and provide optional context details to guide the AI.
            </Typography>
            <CurriculumSelection
              levels={levels}
              classes={classes}
              subjects={subjects}
              strands={strands}
              subStrands={subStrands}
              selections={selections}
              handleSelectionChange={handleSelectionChange}
              isLoading={isLoading}
            />
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Term"
                  name="term"
                  value={strandForm.term}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Week"
                  name="week"
                  value={strandForm.week}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Date"
                  name="dayDate"
                  type="date"
                  value={strandForm.dayDate}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Duration"
                  name="duration"
                  value={strandForm.duration}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Class Size"
                  name="classSize"
                  value={strandForm.classSize}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Content Std. Code"
                  name="contentStandardCode"
                  value={strandForm.contentStandardCode}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Indicator Codes (comma separated)"
                  name="indicatorCodes"
                  value={strandForm.indicatorCodes}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Reference"
                  name="reference"
                  value={strandForm.reference}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Preferred AI Provider"
                  name="preferredProvider"
                  value={strandForm.preferredProvider}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Preferred AI Model"
                  name="preferredModel"
                  value={strandForm.preferredModel}
                  onChange={handleStrandFormChange}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeLearnerFromStrand} disabled={isLoading}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!selections.subStrand || isLoading}
              onClick={handleGenerateLearnerFromStrand}
            >
              {isLoading ? <CircularProgress size={18} /> : 'Generate Learner Note'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Quiz From Lesson Note */}
        <LessonNotePickerDialog
          open={activeDialog === 'quizFromLesson'}
          onClose={() => { closeDialog(); setSelectedLessonForQuiz(''); }}
          title="Generate Quiz from a Lesson Note"
          description="Select a lesson note to use as the source for the quiz."
          lessonNotes={lessonNotes}
          selectedId={selectedLessonForQuiz}
          onSelect={setSelectedLessonForQuiz}
          onConfirm={handleGenerateQuizFromLesson}
          confirmLabel="Generate Quiz"
          isLoading={isLoading}
          fullScreen={isDialogFullscreen('quizFromLesson')}
          onToggleFullscreen={() => toggleDialogFullscreen('quizFromLesson')}
        />

        {/* Quiz From Strands */}
        <Dialog open={activeDialog === 'quizFromStrand'} onClose={() => closeDialog()} fullScreen={isDialogFullscreen('quizFromStrand')} scroll="paper" fullWidth maxWidth={isDialogFullscreen('quizFromStrand') ? false : 'sm'}>
          <DialogTitleWithFullscreen title="Generate Quiz from Strands" isFullscreen={isDialogFullscreen('quizFromStrand')} onToggle={() => toggleDialogFullscreen('quizFromStrand')} />
          <DialogContent tabIndex={0} sx={dialogBodySx}>
            <Typography variant="body2" sx={{ mb: 2 }}>Use the curriculum selector below, then tick one or more sub-strands.</Typography>
            <CurriculumSelection
              levels={levels}
              classes={classes}
              subjects={subjects}
              strands={strands}
              subStrands={subStrands}
              selections={selections}
              handleSelectionChange={handleSelectionChange}
              isLoading={isLoading}
            />
            {subStrands.length > 0 && (
              <Paper sx={{ mt: 2, maxHeight: 300, overflow: 'auto', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <List>
                  {subStrands.map(s => (
                    <ListItem key={s._id} disablePadding>
                      <ListItemButton
                        role={undefined}
                        onClick={() => {
                          setQuizSelectedSubStrands(prev =>
                            prev.includes(s._id) ? prev.filter(x => x !== s._id) : [...prev, s._id]
                          );
                        }}
                        sx={selectableListItemSx}
                      >
                        <ListItemText primary={s.name} />
                        <Checkbox edge="end" checked={quizSelectedSubStrands.includes(s._id)} />
                      </ListItemButton>
                    </ListItem>
                  ))}
                  {subStrands.length === 0 && <ListItem><ListItemText primary="No sub-strands available" /></ListItem>}
                </List>
              </Paper>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeDialog()} disabled={isLoading}>Cancel</Button>
            <Button
              variant="contained"
              disabled={quizSelectedSubStrands.length === 0 || isLoading}
              onClick={handleGenerateQuizFromStrands}
            >
              {isLoading ? <CircularProgress size={18} /> : 'Generate Quizzes'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* My Quizzes Dialog */}
        <Dialog open={activeDialog === 'myQuizzes'} onClose={() => closeDialog()} fullScreen={isDialogFullscreen('myQuizzes')} scroll="paper" fullWidth maxWidth={isDialogFullscreen('myQuizzes') ? false : 'md'}>
          <DialogTitleWithFullscreen title="My Quizzes" isFullscreen={isDialogFullscreen('myQuizzes')} onToggle={() => toggleDialogFullscreen('myQuizzes')} />
          <DialogContent tabIndex={0} sx={dialogBodySx}>
            {(!quizzes || quizzes.length === 0) ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">No quizzes created yet. Start by generating a quiz from the "Create New" section.</Typography>
              </Box>
            ) : (
              <List>
                {quizzes.map((quiz) => (
                  <Paper key={quiz._id} sx={dialogListCardSx}>
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="h6" sx={{ wordBreak: 'break-word' }}>{quiz.title}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Created: {quiz.createdAt ? new Date(quiz.createdAt).toLocaleString() : 'Unknown'}
                        </Typography>
                        {quiz.aiProvider && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            Generated by {quiz.aiModel}
                          </Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => handleViewQuiz(quiz._id)}
                        >
                          View
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => handleDeleteQuiz(quiz._id)}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </Box>
                  </Paper>
                ))}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeDialog()}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Analytics Dialog */}
        <AnalyticsDialog
          open={activeDialog === 'analytics'}
          onClose={closeDialog}
          analyticsSummary={analyticsSummary}
          fullScreen={isDialogFullscreen('analytics')}
          onToggleFullscreen={() => toggleDialogFullscreen('analytics')}
        />

        {/* Note creation form modal */}

        {/* Quiz detail viewer */}
        <Dialog open={activeDialog === 'quizView'} onClose={() => { closeDialog(); }} fullScreen={isDialogFullscreen('quizView')} scroll="paper" fullWidth maxWidth={isDialogFullscreen('quizView') ? false : 'md'}>
          <DialogTitleWithFullscreen title="Quiz Details" isFullscreen={isDialogFullscreen('quizView')} onToggle={() => toggleDialogFullscreen('quizView')} />
          <DialogContent tabIndex={0} {...quizProtectionProps} sx={{ position: 'relative', ...dialogBodySx, ...quizProtectionSx }}>

            {currentQuiz ? (
              <Box>
                <Typography variant="h6" gutterBottom>{currentQuiz.title}</Typography>
                <Typography variant="caption" color="text.secondary" gutterBottom>
                  Created: {currentQuiz.createdAt ? new Date(currentQuiz.createdAt).toLocaleString() : 'Unknown'}
                </Typography>

                {Array.isArray(currentQuiz.questions) && currentQuiz.questions.length > 0 && (
                  <>
                    <Typography variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 700 }}>
                      Multiple Choice Questions
                    </Typography>
                    <List>
                      {currentQuiz.questions.map((q, idx) => (
                        <Paper key={q._id} sx={dialogListCardSx}>
                          <Typography><strong>Q{idx + 1}.</strong> {q.text}</Typography>
                          {Array.isArray(q.options) && q.options.length > 0 && (
                            <List>
                              {q.options.map((opt) => (
                                <ListItem key={opt._id}>
                                  <ListItemText
                                    primary={opt.text}
                                    secondary={opt.isCorrect ? 'Correct' : ''}
                                  />
                                </ListItem>
                              ))}
                            </List>
                          )}
                        </Paper>
                      ))}
                    </List>
                  </>
                )}

                {Array.isArray(currentQuiz.shortAnswer) && currentQuiz.shortAnswer.length > 0 && (
                  <>
                    <Typography variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 700 }}>
                      Short Answer Questions
                    </Typography>
                    <List>
                      {currentQuiz.shortAnswer.map((q, idx) => (
                        <Paper key={`sa-${idx}`} sx={dialogListCardSx}>
                          <Typography><strong>Q{idx + 1}.</strong> {q.question}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Expected Answer: {q.expectedAnswer}
                          </Typography>
                        </Paper>
                      ))}
                    </List>
                  </>
                )}

                {Array.isArray(currentQuiz.essay) && currentQuiz.essay.length > 0 && (
                  <>
                    <Typography variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 700 }}>
                      Application/Essay Questions
                    </Typography>
                    <List>
                      {currentQuiz.essay.map((q, idx) => (
                        <Paper key={`essay-${idx}`} sx={dialogListCardSx}>
                          <Typography><strong>Q{idx + 1}.</strong> {q.question}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Marking Guide: {q.markingGuide}
                          </Typography>
                        </Paper>
                      ))}
                    </List>
                  </>
                )}

                {(!Array.isArray(currentQuiz.questions) || currentQuiz.questions.length === 0)
                && (!Array.isArray(currentQuiz.shortAnswer) || currentQuiz.shortAnswer.length === 0)
                && (!Array.isArray(currentQuiz.essay) || currentQuiz.essay.length === 0) && (
                  <Typography color="text.secondary">No questions available.</Typography>
                )}
              </Box>
            ) : (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <CircularProgress />
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleDownloadCurrentQuiz} disabled={!currentQuiz || isChargingDownload || isLoading}>
              {isChargingDownload ? 'Processing payment...' : 'Pay GHC 0.5 & Download'}
            </Button>
            <Button onClick={() => { closeDialog(); }} >Close</Button>
          </DialogActions>
        </Dialog>

        <LessonNoteForm
          open={activeDialog === 'noteForm'}
          onClose={() => closeDialog()}
          onSubmit={handleGenerateNoteSubmit}
          subStrandName={lessonPlanSelectedSubStrands[0]?.name || subStrands.find((s) => s._id === selections.subStrand)?.name || ''}
          selectedTopicNames={lessonPlanSelectedSubStrands.map((topic) => topic.name)}
          selectedTopics={lessonPlanSelectedSubStrands.length > 0
            ? lessonPlanSelectedSubStrands
            : (selections.subStrand
              ? [{
                id: selections.subStrand,
                name: subStrands.find((s) => s._id === selections.subStrand)?.name || '',
                strandName: subStrands.find((s) => s._id === selections.subStrand)?.strand?.name || '',
              }]
              : [])}
          subStrandId={lessonPlanSelectedSubStrands[0]?.id || selections.subStrand}
          subStrandIds={lessonPlanSelectedSubStrands.map((topic) => topic.id)}
          defaultFacilitatorName={user?.name || ''}
          defaultSchoolName={user?.school || ''}
          schoolCalendar={schoolCalendar}
          isLoading={isLoading || planLoading}
          classId={selections.class}
          subjectId={selections.subject}
          fullScreen={isDialogFullscreen('lessonNoteForm')}
          onToggleFullscreen={() => toggleDialogFullscreen('lessonNoteForm')}
        />
        <BundleResultViewer
          open={activeDialog === 'bundleResult'}
          onClose={() => closeDialog()}
          bundleData={bundleResult}
          onPublish={handlePublishBundle}
          onDownloadItem={chargeAndDownloadHtml}
          isDownloadingItem={isChargingDownload || isLoading}
          fullScreen={isDialogFullscreen('bundleResultViewer')}
          onToggleFullscreen={() => toggleDialogFullscreen('bundleResultViewer')}
        />
        
        {/* Delete Confirmations */}
        <ConfirmDialog
          open={!!noteToDelete}
          title="Delete Lesson Note"
          message="Are you sure you want to delete this lesson note? This action cannot be undone."
          severity="error"
          confirmLabel="Delete"
          onConfirm={handleDeleteLessonNote}
          onCancel={() => setNoteToDelete(null)}
        />

        <ConfirmDialog
          open={!!learnerNoteToDelete}
          title="Delete Learner Note"
          message="Are you sure you want to delete this learner note? This action cannot be undone."
          severity="error"
          confirmLabel="Delete"
          onConfirm={handleDeleteLearnerNote}
          onCancel={() => setLearnerNoteToDelete(null)}
        />

        {/* Note Preview */}
        <NotePreviewDialog
          open={!!viewingNote}
          onClose={() => displayNote(null)}
          note={viewingNote}
          segments={previewSegments}
          contentId="teacher-note-preview-content"
          downloadMenuAnchorEl={downloadMenuAnchorEl}
          onOpenDownloadMenu={handleOpenDownloadMenu}
          onCloseDownloadMenu={handleCloseDownloadMenu}
          onDownload={handleDownloadViewingNote}
          isPdfExporting={isPdfExporting}
          isChargingDownload={isChargingDownload}
          fullScreen={isDialogFullscreen('notePreview')}
          onToggleFullscreen={() => toggleDialogFullscreen('notePreview')}
          title={[
            getLessonNoteName(viewingNote),
          ].filter(Boolean).join('') || 'Preview Lesson Note'}
        />

        <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar(p => ({ ...p, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={() => setSnackbar(p => ({ ...p, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}

export default TeacherDashboard;