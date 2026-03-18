import { mountProtectedPage } from '../bootstrap/mountPage';
import NotesView from '../views/notes/NotesView.vue';

void mountProtectedPage({
  component: NotesView,
  currentPath: '/notes',
  title: '笔记'
});
