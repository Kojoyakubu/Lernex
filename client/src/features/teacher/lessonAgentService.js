import api from '../../api/axios';

const generateAgentLessons = async ({ request, classId, subjectId, term, weeks, regenerate }) => {
  const response = await api.post('/api/teacher/agent/generate', {
    request,
    classId,
    subjectId,
    term,
    weeks,
    regenerate,
  });
  return response.data;
};

export default { generateAgentLessons };