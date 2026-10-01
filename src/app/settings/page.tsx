import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SettingsForm } from "@/components/SettingsForm";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const [interests, notifPrefs, focus] = await Promise.all([
    db.userInterest.findMany({ where: { userId: user.id } }),
    db.notificationPreference.findUnique({ where: { userId: user.id } }),
    db.userFocus.findUnique({ where: { userId: user.id } })
  ]);

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">Settings</h1>
      <div className="mt-6 max-w-2xl">
        <SettingsForm
          initialInterests={interests.map((i: any) => i.topic)}
          initialNotifPrefs={{
            dailyBriefEnabled: notifPrefs?.dailyBriefEnabled ?? false,
            dailyBriefTime: notifPrefs?.dailyBriefTime ?? "08:00",
            importantAlerts: notifPrefs?.importantAlerts ?? false
          }}
          initialFocus={{
            request: focus?.request ?? "",
            mutedKeywords: focus?.mutedKeywords ?? [],
            mutedSources: focus?.mutedSources ?? []
          }}
        />
      </div>
    </div>
  );
}
