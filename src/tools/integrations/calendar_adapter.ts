export interface CalendarProvider {
  /**
   * Identifies available time blocks in the user's agenda for study sessions.
   */
  findAvailableSlots(durationMinutes: number, timeFrame: { start: string, end: string }): Promise<string[]>;

  /**
   * Schedules a study session in the user's calendar and sets up reminders.
   */
  scheduleSession(topic: string, startTime: string, durationMinutes: number): Promise<string>;

  /**
   * Attempts to rearrange non-critical events to accommodate high-priority study sessions.
   */
  rearrangeAgenda(priority: string): Promise<boolean>;
}

/**
 * Mock implementation of the Calendar Provider.
 * As per the architectural guidelines (Rule 48: Fuera de alcance -> Google Calendar real),
 * this remains an interface-only adapter until L2 implementations.
 */
export class StubCalendarAdapter implements CalendarProvider {
  async findAvailableSlots(durationMinutes: number, timeFrame: { start: string, end: string }): Promise<string[]> {
    console.warn("[StubCalendarAdapter] findAvailableSlots called - NOT IMPLEMENTED");
    return [];
  }

  async scheduleSession(topic: string, startTime: string, durationMinutes: number): Promise<string> {
    console.warn(`[StubCalendarAdapter] scheduleSession (${topic}) called - NOT IMPLEMENTED`);
    return `stub_event_id_${Date.now()}`;
  }

  async rearrangeAgenda(priority: string): Promise<boolean> {
    console.warn(`[StubCalendarAdapter] rearrangeAgenda (${priority}) called - NOT IMPLEMENTED`);
    return false;
  }
}
