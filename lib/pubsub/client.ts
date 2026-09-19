import "server-only";
import { randomUUID } from "node:crypto";
import { PubSub } from "@google-cloud/pubsub";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export interface NotifyTarget {
  email: string;
  name: string;
}

export interface BaseEvent {
  event_type: string;
  source: string;
  timestamp: string;
  /**
   * Ties this event to the action that caused it. comms logs it beside the
   * Resend message id, so one admin click can be followed from here through
   * to the sent email. Left unset, publishEvent mints one.
   */
  correlation_id?: string;
  notify?: NotifyTarget[];
  notify_link?: string;
  /**
   * Where the reader turns this mail off — the account page. Set it for mail
   * a reader can turn off and leave it unset for the rest: comms prints a
   * "Manage notifications" link in the footer when it is there, and mail with
   * no setting behind it must not offer one. `manageLink()` answers both.
   */
  manage_link?: string;
  data: Record<string, unknown>;
}

let pubsubClient: PubSub | null = null;

function getClient(): PubSub {
  if (!pubsubClient) {
    pubsubClient = new PubSub({ projectId: requiredEnv("GCP_PROJECT_ID") });
  }
  return pubsubClient;
}

export async function publishEvent(event: BaseEvent): Promise<string> {
  const topic = getClient().topic(requiredEnv("PUBSUB_TOPIC"));
  // Every event gets one whether or not the caller cared, so no publisher has
  // to remember. A caller that wants to log the id itself passes its own.
  const correlationId = event.correlation_id ?? randomUUID();
  const messageId = await topic.publishMessage({
    json: { ...event, correlation_id: correlationId },
  });
  console.log(
    `Published event ${event.event_type} (message ${messageId}, correlation_id ${correlationId})`,
  );
  return messageId;
}
