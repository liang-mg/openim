import { createHashRouter } from "react-router-dom";

import { MainContentLayout } from "@/layout/MainContentLayout";
import { MainContentWrap } from "@/layout/MainContentWrap";
import { EmptyChat } from "@/pages/chat/EmptyChat";
import { QueryChat } from "@/pages/chat/queryChat";

import contactRoutes from "./ContactRoutes";
import GlobalErrorElement from "./GlobalErrorElement";

const router = createHashRouter([
  {
    path: "/",
    element: <MainContentWrap />,
    errorElement: <GlobalErrorElement />,
    children: [
      {
        path: "/",
        element: <MainContentLayout />,
        children: [
          {
            path: "/chat",
            async lazy() {
              const { Chat } = await import("@/pages/chat");
              return { Component: Chat };
            },
            children: [
              {
                index: true,
                element: <EmptyChat />,
              },
              {
                path: ":conversationID",
                element: <QueryChat />,
              },
            ],
          },
          {
            path: "contact",
            async lazy() {
              const { Contact } = await import("@/pages/contact");
              return { Component: Contact };
            },
            children: contactRoutes,
          },
          {
            path: "work",
            async lazy() {
              const { Work } = await import("@/pages/work");
              return { Component: Work };
            },
          },
          {
            path: "checkin",
            async lazy() {
              const { Checkin } = await import("@/pages/checkin");
              return { Component: Checkin };
            },
          },
          {
            path: "attendance",
            async lazy() {
              const { Attendance } = await import("@/pages/attendance");
              return { Component: Attendance };
            },
          },
          {
            path: "report",
            async lazy() {
              const { Report } = await import("@/pages/report");
              return { Component: Report };
            },
          },
          {
            path: "leave",
            async lazy() {
              const { Leave } = await import("@/pages/leave");
              return { Component: Leave };
            },
          },
          {
            path: "report-review",
            async lazy() {
              const { ReportReview } = await import("@/pages/report-review");
              return { Component: ReportReview };
            },
          },
          {
            path: "oa-admin",
            async lazy() {
              const { OaAdmin } = await import("@/pages/oa-admin");
              return { Component: OaAdmin };
            },
          },
          {
            path: "mine",
            async lazy() {
              const { Mine } = await import("@/pages/mine");
              return { Component: Mine };
            },
          },
        ],
      },
      {
        path: "login",
        async lazy() {
          const { Login } = await import("@/pages/login");
          return { Component: Login };
        },
      },
    ],
  },
]);

export default router;
