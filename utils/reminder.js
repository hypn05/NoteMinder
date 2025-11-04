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
    console.log('[ReminderManager] Checking reminders at:', new Date().toLocaleString());
    if (this.notificationCallback) {
      this.notificationCallback();
    }
  }

  getNextReminderTime(reminder) {
    if (!reminder || !reminder.enabled) {
      console.log('[getNextReminderTime] Reminder is null or disabled');
      return null;
    }

    const now = new Date();
    console.log('[getNextReminderTime] Current time:', now.toISOString());
    console.log('[getNextReminderTime] Reminder type:', reminder.type);
    console.log('[getNextReminderTime] Reminder time:', reminder.time);
    
    const [hours, minutes] = reminder.time.split(':').map(Number);

    if (reminder.type === 'once') {
      console.log('[getNextReminderTime] Reminder date:', reminder.date);
      
      // Parse the date string properly to avoid timezone issues
      const [year, month, day] = reminder.date.split('-').map(Number);
      const reminderDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      
      console.log('[getNextReminderTime] Calculated reminder datetime:', reminderDate.toISOString());
      console.log('[getNextReminderTime] Calculated reminder datetime (local):', reminderDate.toLocaleString());
      console.log('[getNextReminderTime] Is future?', reminderDate >= now);
      
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
    console.log('[formatReminderDisplay] Input reminder:', JSON.stringify(reminder, null, 2));
    
    const nextTime = this.getNextReminderTime(reminder);
    console.log('[formatReminderDisplay] Next time calculated:', nextTime ? nextTime.toISOString() : 'null');
    
    if (!nextTime) {
      console.log('[formatReminderDisplay] Returning null - no next time');
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
    
    console.log('[formatReminderDisplay] Returning:', result);
    return result;
  }

  isDue(reminder) {
    if (!reminder || !reminder.enabled) {
      return false;
    }

    const now = new Date();
    const [hours, minutes] = reminder.time.split(':').map(Number);

    if (reminder.type === 'once') {
      // Parse the date string properly to avoid timezone issues
      const [year, month, day] = reminder.date.split('-').map(Number);
      const reminderDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      
      console.log('[isDue] Checking once reminder:');
      console.log('  Current time:', now.toISOString(), '(', now.toLocaleString(), ')');
      console.log('  Reminder time:', reminderDate.toISOString(), '(', reminderDate.toLocaleString(), ')');
      console.log('  Time difference (seconds):', (reminderDate - now) / 1000);
      
      // Check if reminder time has passed and hasn't been triggered yet
      // Use a 2-minute window to account for check intervals
      const twoMinutesAgo = new Date(now.getTime() - 120000);
      const isPast = reminderDate <= now;
      const isWithinWindow = reminderDate > twoMinutesAgo;
      
      console.log('  Is past or current?', isPast);
      console.log('  Is within 2-min window?', isWithinWindow);
      console.log('  Result (isDue):', isPast && isWithinWindow);
      
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
