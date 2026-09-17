import api from '../../api/axios';

const getMySchemes = async () => (await api.get('/api/schemes')).data;

const uploadScheme = async ({ classId, subjectId, term, file }) => {
  const formData = new FormData();
  formData.append('classId', classId);
  formData.append('subjectId', subjectId);
  formData.append('term', term);
  formData.append('schemeFile', file);
  return (await api.post('/api/schemes/upload', formData, {
    headers: { 'Content-Type': undefined },
  })).data;
};

const updateScheme = async ({ schemeId, entries, importStatus }) => (
  await api.put(`/api/schemes/${schemeId}`, { entries, importStatus })
).data;

const getSchemeWeeks = async (schemeId) => (await api.get(`/api/schemes/${schemeId}/weeks`)).data;
const getCurrentCurriculum = async ({ classId, subjectId, term, week }) => (
  await api.get('/api/schemes/current', { params: { classId, subjectId, term, week } })
).data;

const schemeService = { getMySchemes, uploadScheme, updateScheme, getSchemeWeeks, getCurrentCurriculum };
export default schemeService;