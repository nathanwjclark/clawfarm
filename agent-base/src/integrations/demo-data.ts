import type { IntegrationSimConfig, SimMessage } from "./integration-sim.js";

/**
 * Demo integration sim configs for testing and demo mode.
 * These provide realistic fake data for Slack and Email integrations.
 */

// --- Slack Demo Data ---

const slackMessages: SimMessage[] = [
  {
    id: "slack-1",
    from: "Sarah Chen",
    content: "Hey, did anyone finish reviewing the Q1 marketing report? Client meeting is tomorrow at 2pm.",
    timestamp: "2026-03-08T09:15:00Z",
    channel: "#marketing",
    read: false,
  },
  {
    id: "slack-2",
    from: "Jake Torres",
    content: "I pushed the new landing page design to staging. Can someone take a look? https://staging.example.com/landing-v2",
    timestamp: "2026-03-08T09:30:00Z",
    channel: "#design",
    read: false,
  },
  {
    id: "slack-3",
    from: "Lisa Park",
    content: "Reminder: sprint retro at 3pm today. Please fill out the feedback form beforehand.",
    timestamp: "2026-03-08T10:00:00Z",
    channel: "#engineering",
    read: true,
  },
  {
    id: "slack-4",
    from: "Michael",
    content: "The API rate limits are causing issues on the import job again. Same error as last week — 429s after about 2000 records.",
    timestamp: "2026-03-08T10:15:00Z",
    channel: "#engineering",
    read: false,
  },
  {
    id: "slack-5",
    from: "Sarah Chen",
    content: "Also @Michael — the client wants to add two more product lines to the comparison chart. Can you update the data model?",
    timestamp: "2026-03-08T10:20:00Z",
    channel: "#marketing",
    read: false,
  },
];

const slackDeterministicResponses: SimMessage[] = [
  {
    id: "slack-resp-1",
    from: "Sarah Chen",
    content: "Thanks! The updated numbers look great. I'll incorporate them into the deck for tomorrow.",
    timestamp: "",
    channel: "#marketing",
  },
  {
    id: "slack-resp-2",
    from: "Jake Torres",
    content: "Good catch on the mobile layout. I'll fix the breakpoints and redeploy to staging within the hour.",
    timestamp: "",
    channel: "#design",
  },
  {
    id: "slack-resp-3",
    from: "Michael",
    content: "Perfect, that batch size approach should work. Let me know if you need help testing it against the staging API.",
    timestamp: "",
    channel: "#engineering",
  },
];

export const DEMO_SLACK_CONFIG: IntegrationSimConfig = {
  type: "slack",
  name: "work-slack",
  responseMode: {
    type: "deterministic",
    responses: slackDeterministicResponses,
  },
  initialMessages: slackMessages,
  scheduledEvents: [
    {
      type: "incoming_message",
      data: {
        id: "slack-event-1",
        from: "DevOps Bot",
        content: "🔴 ALERT: Production memory usage at 92%. Auto-scaling triggered. Current pod count: 8 → 12.",
        timestamp: "2026-03-08T10:45:00Z",
        channel: "#alerts",
      },
      trigger: { afterMessageIndex: 2 },
    },
    {
      type: "mention",
      data: {
        id: "slack-event-2",
        from: "Lisa Park",
        content: "@agent Can you summarize what we decided about the API rate limit fix? I missed the discussion.",
        timestamp: "2026-03-08T11:00:00Z",
        channel: "#engineering",
      },
      trigger: { afterMessageIndex: 4 },
    },
  ],
};

// --- Email Demo Data ---

const emailMessages: SimMessage[] = [
  {
    id: "email-1",
    from: "alex.rivera@partnerco.com",
    subject: "Partnership Proposal — Joint Webinar Series",
    content:
      "Hi Michael,\n\nFollowing up on our conversation at the conference. We'd love to co-host a 3-part webinar series on AI-powered productivity tools. Our audience of 50K+ product managers would be a great fit.\n\nProposed dates: April 15, 22, 29\nFormat: 45min presentation + 15min Q&A\n\nWould your team be interested? Happy to discuss details.\n\nBest,\nAlex Rivera\nHead of Partnerships, PartnerCo",
    timestamp: "2026-03-07T16:30:00Z",
    read: false,
  },
  {
    id: "email-2",
    from: "noreply@github.com",
    subject: "[clawfarm] CI Pipeline Failed — main branch",
    content:
      "Build #1847 failed on main.\n\nFailing job: integration-tests\nError: Connection timeout to test database after 30s\nCommit: abc123f by jake.torres\n\nView details: https://github.com/example/clawfarm/actions/runs/1847",
    timestamp: "2026-03-08T08:00:00Z",
    read: true,
  },
  {
    id: "email-3",
    from: "quarterly-report@analytics.internal",
    subject: "Q1 2026 Agent Performance Summary",
    content:
      "Quarterly Summary:\n\n- Active agents: 12 (+3 from Q4)\n- Total conversations: 48,291\n- Avg satisfaction: 4.2/5.0\n- Memory recall accuracy: 78% (up from 71%)\n- Cost per conversation: $0.34 (down 12%)\n\nTop performing variant: native-0d-tuned (4.5/5.0 satisfaction)\nNeeds attention: mem0-1d-aggressive (high error rate, 8.3%)",
    timestamp: "2026-03-08T07:00:00Z",
    read: false,
  },
];

const emailDeterministicResponses: SimMessage[] = [
  {
    id: "email-resp-1",
    from: "alex.rivera@partnerco.com",
    subject: "Re: Partnership Proposal — Joint Webinar Series",
    content:
      "That sounds great! April dates work for us. I'll send over a draft agenda by end of week.\n\nFor speaker slots, we can provide 2 speakers from our side. Would you want to present on the memory architecture side?\n\nLooking forward to it.\n\n— Alex",
    timestamp: "",
  },
  {
    id: "email-resp-2",
    from: "lisa.park@company.com",
    subject: "Re: Sprint Retro Notes",
    content:
      "Thanks for the summary. I agree we should prioritize the rate limit fix in the next sprint. I'll add it to the board.\n\n— Lisa",
    timestamp: "",
  },
];

export const DEMO_EMAIL_CONFIG: IntegrationSimConfig = {
  type: "email",
  name: "work-email",
  responseMode: {
    type: "deterministic",
    responses: emailDeterministicResponses,
  },
  initialMessages: emailMessages,
  scheduledEvents: [
    {
      type: "incoming_message",
      data: {
        id: "email-event-1",
        from: "cto@company.com",
        subject: "Urgent: Board Presentation Update Needed",
        content:
          "Michael,\n\nThe board meeting moved to this Friday. I need updated numbers on agent performance and cost projections for Q2.\n\nCan you pull the latest from the dashboard and send me a one-pager by Thursday EOD?\n\nThanks,\nDavid",
        timestamp: "2026-03-08T11:30:00Z",
      },
      trigger: { afterSessionIndex: 1 },
    },
  ],
};

/**
 * Get all demo integration configs for a given mode.
 */
export function getDemoIntegrationConfigs(): IntegrationSimConfig[] {
  return [DEMO_SLACK_CONFIG, DEMO_EMAIL_CONFIG];
}
