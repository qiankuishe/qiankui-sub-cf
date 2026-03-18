import { mountProtectedPage } from '../bootstrap/mountPage';
import SubscriptionsView from '../views/subscriptions/SubscriptionsView.vue';

void mountProtectedPage({
  component: SubscriptionsView,
  currentPath: '/subscriptions',
  title: '订阅聚合'
});
