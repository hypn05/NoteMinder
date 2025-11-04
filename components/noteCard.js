// Reusable note card component
class NoteCard {
  constructor(note, options = {}) {
    this.note = note;
    this.onClick = options.onClick;
    this.onDelete = options.onDelete;
    this.onSetReminder = options.onSetReminder;
    this.isActive = options.isActive || false;
  }

  render() {
    const card = document.createElement('div');
    card.className = 'note-card card';
    if (this.isActive) {
      card.classList.add('active');
    }
    
    // Calculate text color if background is set
    let textColor = null;
    if (this.note.backgroundColor) {
      card.style.backgroundColor = this.note.backgroundColor;
      // Adjust text color based on background
      const rgb = this.rgbaToRgb(this.note.backgroundColor);
      const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
      textColor = brightness > 180 ? '#1a1a1a' : '#e0e0e0';
      card.style.color = textColor;
    }
    
    // Note preview - extract only the first element's text as title
    const preview = document.createElement('div');
    preview.className = 'note-preview';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.note.content;
    
    // Get only the first child element's text
    let titleText = '';
    if (tempDiv.firstChild) {
      titleText = tempDiv.firstChild.textContent?.trim() || '';
    }
    
    if (titleText) {
      const heading = document.createElement('div');
      heading.style.fontWeight = 'bold';
      heading.style.fontSize = '1.1em';
      heading.textContent = titleText.substring(0, 50) + (titleText.length > 50 ? '...' : '');
      if (textColor) {
        heading.style.color = textColor;
      }
      preview.appendChild(heading);
    } else {
      preview.textContent = 'Empty note';
      if (textColor) {
        preview.style.color = textColor;
      }
    }
    
    // Note metadata
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    
    const dateDiv = document.createElement('div');
    dateDiv.className = 'note-date';
    dateDiv.innerHTML = `<span>📅</span> ${this.formatDate(this.note.updated)}`;
    if (textColor) {
      dateDiv.style.color = textColor;
    }
    
    const actions = document.createElement('div');
    actions.className = 'note-actions';
    
    // Reminder button
    const reminderBtn = document.createElement('button');
    reminderBtn.className = 'note-action-btn';
    reminderBtn.innerHTML = '⏰';
    reminderBtn.title = 'Set reminder';
    if (textColor) {
      reminderBtn.style.color = textColor;
      reminderBtn.style.opacity = '0.8';
    }
    reminderBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.onSetReminder) {
        this.onSetReminder(this.note);
      }
    };
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-action-btn';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.title = 'Delete note';
    if (textColor) {
      deleteBtn.style.color = textColor;
      deleteBtn.style.opacity = '0.8';
    }
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.onDelete) {
        this.onDelete(this.note);
      }
    };
    
    actions.appendChild(reminderBtn);
    actions.appendChild(deleteBtn);
    
    meta.appendChild(dateDiv);
    meta.appendChild(actions);
    
    card.appendChild(preview);
    card.appendChild(meta);
    
    // Add reminder badges if exist
    if (this.note.reminders && this.note.reminders.length > 0) {
      const activeReminders = this.note.reminders.filter(r => r.enabled);
      if (activeReminders.length > 0) {
        const remindersContainer = document.createElement('div');
        remindersContainer.style.marginTop = '8px';
        remindersContainer.style.display = 'flex';
        remindersContainer.style.flexDirection = 'column';
        remindersContainer.style.gap = '4px';
        
        activeReminders.forEach(reminder => {
          const badge = this.createReminderBadge(reminder, textColor);
          if (badge) {
            remindersContainer.appendChild(badge);
          }
        });
        
        if (remindersContainer.children.length > 0) {
          card.appendChild(remindersContainer);
        }
      }
    }
    
    // Click handler
    card.onclick = () => {
      if (this.onClick) {
        this.onClick(this.note);
      }
    };
    
    return card;
  }

  createReminderBadge(reminder, textColor = null) {
    const badge = document.createElement('div');
    badge.className = 'badge note-reminder-badge';
    badge.style.fontSize = '11px';
    badge.style.padding = '4px 8px';
    badge.style.marginTop = '2px';
    
    const text = this.formatReminderText(reminder);
    // Don't show badge if reminder is in the past
    if (!text) return null;
    
    badge.innerHTML = `⏰ ${text}`;
    
    // Apply text color if provided (for colored note backgrounds)
    if (textColor) {
      badge.style.color = textColor;
      badge.style.borderColor = textColor;
      badge.style.opacity = '0.9';
    }
    
    return badge;
  }

  formatReminderText(reminder) {
    const now = new Date();
    const [hours, minutes] = reminder.time.split(':').map(Number);

    if (reminder.type === 'once') {
      const reminderDate = new Date(reminder.date);
      reminderDate.setHours(hours, minutes, 0, 0);
      
      // Don't show badge for past one-time reminders
      if (reminderDate < now) {
        return null;
      }
      
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const reminderDay = new Date(reminderDate);
      reminderDay.setHours(0, 0, 0, 0);
      
      const diffDays = Math.floor((reminderDay - today) / (1000 * 60 * 60 * 24));
      const timeStr = reminderDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      
      if (diffDays === 0) {
        return `Today at ${timeStr}`;
      } else if (diffDays === 1) {
        return `Tomorrow at ${timeStr}`;
      } else if (diffDays < 7) {
        const dayName = reminderDate.toLocaleDateString('en-US', { weekday: 'short' });
        return `${dayName} at ${timeStr}`;
      } else {
        return reminderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` at ${timeStr}`;
      }
    }

    if (reminder.type === 'daily') {
      const today = new Date(now);
      today.setHours(hours, minutes, 0, 0);
      const timeStr = today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      
      if (today > now) {
        return `Today at ${timeStr}`;
      } else {
        return `Tomorrow at ${timeStr}`;
      }
    }

    if (reminder.type === 'weekly') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
      const timeStr = nextReminder.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      
      if (daysUntilTarget === 0) {
        return `Today at ${timeStr}`;
      } else if (daysUntilTarget === 1) {
        return `Tomorrow at ${timeStr}`;
      } else if (daysUntilTarget < 7) {
        return `${days[targetDay]} at ${timeStr}`;
      } else {
        return `Next ${days[targetDay]} at ${timeStr}`;
      }
    }

    return 'Reminder set';
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  rgbaToRgb(rgba) {
    // Extract RGB values from rgba string
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3])
      };
    }
    // Fallback to hexToRgb if it's a hex color
    return this.hexToRgb(rgba);
  }
}

module.exports = NoteCard;
