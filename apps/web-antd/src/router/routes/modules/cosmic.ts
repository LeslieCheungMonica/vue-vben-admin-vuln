import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:rocket',
      order: 0,
      title: $t('page.cosmic.title'),
    },
    name: 'Cosmic',
    path: '/cosmic',
    children: [
      {
        name: 'CosmicDocs',
        path: '/cosmic/docs',
        component: () => import('#/views/cosmic/docs/index.vue'),
        meta: {
          icon: 'lucide:book-open',
          title: $t('page.cosmic.docs'),
        },
      },
      {
        name: 'CosmicTasks',
        path: '/cosmic/tasks',
        component: () => import('#/views/cosmic/tasks/index.vue'),
        meta: {
          icon: 'lucide:list-todo',
          title: $t('page.cosmic.tasks'),
        },
      },
      {
        name: 'CosmicTaskDetail',
        path: 'task/detail/:taskId',
        component: () => import('#/views/cosmic/tasks/detail.vue'),
        meta: {
          hideInMenu: true,
          title: 'Cosmic 任务详情',
        },
      },
    ],
  },
];

export default routes;