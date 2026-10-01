import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
  findMany: vi.fn(),
  deleteOne: vi.fn().mockResolvedValue({})
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification
  }
}));

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      findMany: mocks.findMany,
      delete: mocks.deleteOne
    }
  }
}));

process.env.VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";

import { sendPushToUser } from "./webpush";

const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "key", auth: "auth" });

describe("sendPushToUser — truthful delivery reporting", () => {
  beforeEach(() => {
    mocks.sendNotification.mockReset();
    mocks.findMany.mockReset();
    mocks.deleteOne.mockClear();
  });

  it("reports a successful delivery", async () => {
    mocks.findMany.mockResolvedValue([sub("a")]);
    mocks.sendNotification.mockResolvedValue(undefined);

    const result = await sendPushToUser("user1", { title: "t", body: "b" });
    expect(result).toEqual({ attempted: 1, delivered: 1, removed: 0, failed: 0 });
  });

  it("removes an expired subscription (410) and reports it as removed, not delivered", async () => {
    mocks.findMany.mockResolvedValue([sub("a")]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 410 });

    const result = await sendPushToUser("user1", { title: "t", body: "b" });
    expect(result).toEqual({ attempted: 1, delivered: 0, removed: 1, failed: 0 });
    expect(mocks.deleteOne).toHaveBeenCalledWith({ where: { id: "a" } });
  });

  it("removes a 404 subscription the same way as 410", async () => {
    mocks.findMany.mockResolvedValue([sub("a")]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 404 });

    const result = await sendPushToUser("user1", { title: "t", body: "b" });
    expect(result.removed).toBe(1);
    expect(result.delivered).toBe(0);
  });

  it("reports delivered: 0 when every subscription fails for a non-expiry reason", async () => {
    mocks.findMany.mockResolvedValue([sub("a"), sub("b")]);
    mocks.sendNotification.mockRejectedValue({ statusCode: 500 });

    const result = await sendPushToUser("user1", { title: "t", body: "b" });
    expect(result).toEqual({ attempted: 2, delivered: 0, removed: 0, failed: 2 });
  });

  it("correctly counts a mix of one success and one failure", async () => {
    mocks.findMany.mockResolvedValue([sub("a"), sub("b")]);
    mocks.sendNotification.mockImplementation((target: any) =>
      target.endpoint.endsWith("/a") ? Promise.resolve() : Promise.reject({ statusCode: 500 })
    );

    const result = await sendPushToUser("user1", { title: "t", body: "b" });
    expect(result).toEqual({ attempted: 2, delivered: 1, removed: 0, failed: 1 });
  });

  it("reports attempted: 0 with no subscriptions at all", async () => {
    mocks.findMany.mockResolvedValue([]);
    const result = await sendPushToUser("user1", { title: "t", body: "b" });
    expect(result).toEqual({ attempted: 0, delivered: 0, removed: 0, failed: 0 });
  });
});
