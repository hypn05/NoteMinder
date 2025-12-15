// PasswordCard component for displaying password entries in the sidebar
class PasswordCard {
  constructor(password, callbacks) {
    this.password = password;
    this.callbacks = callbacks || {};
  }

  render() {
    const card = document.createElement('div');
    card.className = 'password-card';
    card.dataset.passwordId = this.password.id;
    
    // Add active class if this is the active password
    if (this.callbacks.isActive) {
      card.classList.add('active');
    }
    
    const label = this.password.label || 'Untitled Password';
    
    card.innerHTML = `
      <div class="password-card-header">
        <div class="password-card-content">
          <div class="password-card-title">${this.escapeHtml(label)}</div>
        </div>
      </div>
      <div class="password-card-actions">
        <button class="password-action-btn copy-password" title="Copy password">📋</button>
        <button class="password-action-btn" title="More options">⋮</button>
      </div>
    `;
    
    // Add click handlers for action buttons
    const copyBtn = card.querySelector('.copy-password');
    const moreBtn = card.querySelector('.password-action-btn:last-child');
    
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.callbacks.onCopyPassword) {
        await this.callbacks.onCopyPassword(this.password);
      }
    });
    
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showContextMenu(e.clientX, e.clientY);
    });
    
    // Click handler - open password modal
    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.callbacks.onClick) {
        this.callbacks.onClick(this.password);
      }
    });
    
    // Context menu handler
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY);
    });
    
    // Drag and drop for reordering
    card.draggable = true;
    
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.password.id);
      card.classList.add('dragging');
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      const draggingCard = document.querySelector('.password-card.dragging');
      if (!draggingCard || draggingCard === card) return;
      
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midpoint;
      
      if (insertBefore) {
        card.classList.add('drag-over-top');
        card.classList.remove('drag-over-bottom');
      } else {
        card.classList.add('drag-over-bottom');
        card.classList.remove('drag-over-top');
      }
    });
    
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId === this.password.id) return;
      
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midpoint;
      
      if (this.callbacks.onReorder) {
        this.callbacks.onReorder(draggedId, this.password.id, insertBefore);
      }
    });
    
    return card;
  }

  showContextMenu(x, y) {
    // Remove existing context menu
    const existing = document.querySelector('.password-context-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.className = 'password-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.zIndex = '10000';
    
    const items = [
      {
        icon: this.password.isFavorite ? '☆' : '⭐',
        label: this.password.isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        action: () => {
          if (this.callbacks.onToggleFavorite) {
            this.callbacks.onToggleFavorite(this.password);
          }
        }
      },
      {
        icon: '📋',
        label: 'Copy Username',
        action: async () => {
          if (this.callbacks.onCopyUsername) {
            await this.callbacks.onCopyUsername(this.password);
          }
        }
      },
      {
        icon: '🔑',
        label: 'Copy Password',
        action: async () => {
          if (this.callbacks.onCopyPassword) {
            await this.callbacks.onCopyPassword(this.password);
          }
        }
      },
      {
        icon: '🗑️',
        label: 'Delete',
        action: () => {
          if (this.callbacks.onDelete) {
            this.callbacks.onDelete(this.password);
          }
        },
        danger: true
      }
    ];
    
    items.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      if (item.danger) {
        menuItem.classList.add('danger');
      }
      menuItem.innerHTML = `<span>${item.icon}</span> ${item.label}`;
      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        item.action();
        menu.remove();
      });
      menu.appendChild(menuItem);
    });
    
    document.body.appendChild(menu);
    
    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

module.exports = PasswordCard;
