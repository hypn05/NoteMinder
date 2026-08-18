// Reusable reminder utility for managing and checking reminders
class ReminderManager {
  constructor(notificationCallback) {
    this.notificationCallback = notificationCallback;
    this.checkInterval = null;
  }

  start() {
    // Check every 10 seconds for due reminders
    this.checkInterval = setInterval(() => {
      this.checkReminders();
    }, 10000);
    
    // Also check immediately on start
    this.checkReminders();
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  checkReminders() {
    if (this.notificationCallback) {
      this.notificationCallback();
    }
  }

  getNextReminderTime(reminder) {
    if (!reminder || !reminder.enabled) {
      return null;
    }

    // Snoozed reminders report the snooze target as their next time.
    if (reminder.snoozeUntil) {
      const snoozeTime = new Date(reminder.snoozeUntil);
      if (snoozeTime > new Date()) {
        return snoozeTime;
      }
    }

    const now = new Date();
    const [hours, minutes] = reminder.time.split(':').map(Number);

    if (reminder.type === 'once') {
      // Parse the date string properly to avoid timezone issues
      const [year, month, day] = reminder.date.split('-').map(Number);
      const reminderDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

      // Allow reminders set for current time or future
      return reminderDate >= now ? reminderDate : null;
    }

    if (reminder.type === 'daily') {
      const today = new Date(now);
      today.setHours(hours, minutes, 0, 0);
      
      if (today > now) {
        return today;
      } else {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      }
    }

    if (reminder.type === 'weekly') {
      const targetDay = reminder.dayOfWeek;
      const currentDay = now.getDay();
      
      let daysUntilTarget = targetDay - currentDay;
      if (daysUntilTarget < 0) {
        daysUntilTarget += 7;
      } else if (daysUntilTarget === 0) {
        const todayTime = new Date(now);
        todayTime.setHours(hours, minutes, 0, 0);
        if (todayTime <= now) {
          daysUntilTarget = 7;
        }
      }

      const nextReminder = new Date(now);
      nextReminder.setDate(now.getDate() + daysUntilTarget);
      nextReminder.setHours(hours, minutes, 0, 0);
      return nextReminder;
    }

    return null;
  }

  formatReminderDisplay(reminder) {
    const nextTime = this.getNextReminderTime(reminder);

    if (!nextTime) {
      return 'No upcoming time';
    }

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    const reminderDay = new Date(nextTime);
    reminderDay.setHours(0, 0, 0, 0);
    
    const diffDays = Math.floor((reminderDay - today) / (1000 * 60 * 60 * 24));
    const timeStr = nextTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    let result;
    if (diffDays === 0) {
      result = `Today at ${timeStr}`;
    } else if (diffDays === 1) {
      result = `Tomorrow at ${timeStr}`;
    } else if (diffDays < 7) {
      const dayName = nextTime.toLocaleDateString('en-US', { weekday: 'short' });
      result = `${dayName} at ${timeStr}`;
    } else {
      result = nextTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` at ${timeStr}`;
    }

    return result;
  }

  isDue(reminder) {
    if (!reminder || !reminder.enabled) {
      return false;
    }

    const now = new Date();

    // Snooze overrides the normal schedule: due exactly once when the snooze
    // target passes, regardless of the reminder's type/recurrence.
    if (reminder.snoozeUntil) {
      const snoozeTime = new Date(reminder.snoozeUntil);
      if (now < snoozeTime) {
        return false;
      }
      const lastTriggered = reminder.lastTriggered ? new Date(reminder.lastTriggered) : null;
      return !lastTriggered || lastTriggered < snoozeTime;
    }

    const [hours, minutes] = reminder.time.split(':').map(Number);

    if (reminder.type === 'once') {
      // Parse the date string properly to avoid timezone issues
      const [year, month, day] = reminder.date.split('-').map(Number);
      const reminderDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

      // Check if reminder time has passed and hasn't been triggered yet
      // Use a 2-minute window to account for check intervals
      const twoMinutesAgo = new Date(now.getTime() - 120000);
      const isPast = reminderDate <= now;
      const isWithinWindow = reminderDate > twoMinutesAgo;

      return isPast && isWithinWindow;
    }

    if (reminder.type === 'daily') {
      const lastTriggered = reminder.lastTriggered ? new Date(reminder.lastTriggered) : null;
      const todayTrigger = new Date(now);
      todayTrigger.setHours(hours, minutes, 0, 0);
      
      if (now >= todayTrigger) {
        return !lastTriggered || lastTriggered < todayTrigger;
      }
      return false;
    }

    if (reminder.type === 'weekly') {
      const targetDay = reminder.dayOfWeek;
      const currentDay = now.getDay();
      
      if (currentDay === targetDay) {
        const lastTriggered = reminder.lastTriggered ? new Date(reminder.lastTriggered) : null;
        const todayTrigger = new Date(now);
        todayTrigger.setHours(hours, minutes, 0, 0);
        
        if (now >= todayTrigger) {
          return !lastTriggered || lastTriggered < todayTrigger;
        }
      }
      return false;
    }

    return false;
  }
}

module.exports = ReminderManager;
