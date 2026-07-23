// Reusable note card component
class NoteCard {
  constructor(note, options = {}) {
    this.note = note;
    this.options = options;
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
    if (this.note.isFavorite) {
      card.classList.add('favorite');
    }
    
    // Make card draggable
    card.draggable = true;
    card.dataset.noteId = this.note.id;
    
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
    
    // Card header with icon and content
    const cardHeader = document.createElement('div');
    cardHeader.className = 'note-card-header';
    
    // Content area (no icon needed since we have separate tabs)
    const contentArea = document.createElement('div');
    contentArea.className = 'note-card-content';
    
    // Prefer the explicit title field. Fall back to extracting from content
    // for un-migrated notes (defensive — migration normally runs first).
    let titleText = (this.note.title || '').trim();
    if (!titleText) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.note.content;

      const passwordFields = tempDiv.querySelectorAll('.password-field-container');
      passwordFields.forEach(field => field.remove());

      for (const child of tempDiv.childNodes) {
        const text = child.textContent?.trim();
        if (text) {
          titleText = text;
          break;
        }
      }
    }

    const preview = document.createElement('div');
    preview.className = 'note-card-title';
    preview.textContent = titleText || 'Untitled';
    if (textColor) {
      preview.style.color = textColor;
    }
    
    // Subtitle with reminder info if available
    const subtitle = document.createElement('div');
    subtitle.className = 'note-card-subtitle';
    if (this.note.reminders && this.note.reminders.length > 0) {
      const activeReminders = this.note.reminders.filter(r => r.enabled);
      if (activeReminders.length > 0) {
        const reminderText = this.formatReminderText(activeReminders[0]);
        if (reminderText) {
          subtitle.textContent = `⏰ ${reminderText}`;
        }
      }
    }
    if (textColor) {
      subtitle.style.color = textColor;
      subtitle.style.opacity = '0.7';
    }
    
    contentArea.appendChild(preview);
    if (subtitle.textContent) {
      contentArea.appendChild(subtitle);
    }
    
    cardHeader.appendChild(contentArea);
    
    // Actions container (shown on hover)
    const actions = document.createElement('div');
    actions.className = 'note-card-actions';
    
    // Favorite button
    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'note-action-btn';
    favoriteBtn.innerHTML = this.note.isFavorite ? '⭐' : '☆';
    favoriteBtn.title = this.note.isFavorite ? 'Remove from favorites' : 'Add to favorites';
    if (textColor) {
      favoriteBtn.style.color = textColor;
    }
    favoriteBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.options && this.options.onToggleFavorite) {
        this.options.onToggleFavorite(this.note);
      }
    };
    
    // Reminder button
    const reminderBtn = document.createElement('button');
    reminderBtn.className = 'note-action-btn';
    reminderBtn.innerHTML = '⏰';
    reminderBtn.title = 'Set reminder';
    if (textColor) {
      reminderBtn.style.color = textColor;
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
    }
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.onDelete) {
        this.onDelete(this.note);
      }
    };
    
    actions.appendChild(favoriteBtn);
    actions.appendChild(reminderBtn);
    actions.appendChild(deleteBtn);
    
    card.appendChild(cardHeader);
    card.appendChild(actions);
    
    // Click handler
    card.onclick = () => {
      if (this.onClick) {
        this.onClick(this.note);
      }
    };
    
    // Drag and drop handlers
    let autoScrollInterval = null;
    
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.note.id);
      card.classList.add('dragging');
      
      // Add a semi-transparent drag image
      setTimeout(() => {
        card.style.opacity = '0.5';
      }, 0);
      
      // Start auto-scroll interval
      autoScrollInterval = setInterval(() => {
        const notesContainer = document.getElementById('notes-container');
        if (!notesContainer) return;
        
        const rect = notesContainer.getBoundingClientRect();
        const mouseY = this.lastMouseY || 0;
        
        // Define scroll zones (top and bottom 50px of container)
        const scrollZone = 50;
        const scrollSpeed = 5;
        
        if (mouseY < rect.top + scrollZone && mouseY > rect.top) {
          // Scroll up
          notesContainer.scrollTop -= scrollSpeed;
        } else if (mouseY > rect.bottom - scrollZone && mouseY < rect.bottom) {
          // Scroll down
          notesContainer.scrollTop += scrollSpeed;
        }
      }, 16); // ~60fps
    });
    
    card.addEventListener('dragend', (e) => {
      card.classList.remove('dragging');
      card.style.opacity = '1';
      
      // Clear auto-scroll interval
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }
      
      // Remove all drag-over indicators
      document.querySelectorAll('.note-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });
    
    // Track mouse position for auto-scroll
    card.addEventListener('drag', (e) => {
      if (e.clientY !== 0) {
        this.lastMouseY = e.clientY;
      }
    });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      // Track mouse position for auto-scroll
      if (e.clientY !== 0) {
        this.lastMouseY = e.clientY;
      }
      
      const draggingCard = document.querySelector('.dragging');
      if (!draggingCard || draggingCard === card) return;
      
      // Remove previous indicators
      document.querySelectorAll('.note-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      
      // Determine if we should insert before or after
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      
      if (e.clientY < midpoint) {
        card.classList.add('drag-over-top');
      } else {
        card.classList.add('drag-over-bottom');
      }
    });
    
    card.addEventListener('dragleave', (e) => {
      // Only remove if we're actually leaving the card
      if (e.target === card) {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });
    
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const draggedNoteId = e.dataTransfer.getData('text/plain');
      const targetNoteId = this.note.id;
      
      if (draggedNoteId === targetNoteId) return;
      
      // Determine drop position
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midpoint;
      
      // Trigger reorder callback
      if (this.options && this.options.onReorder) {
        this.options.onReorder(draggedNoteId, targetNoteId, insertBefore);
      }
      
      // Clean up
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    
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
