// ClipCard component for displaying saved clipboard snippets in the sidebar
class ClipCard {
  constructor(clip, callbacks) {
    this.clip = clip;
    this.callbacks = callbacks || {};
  }

  render() {
    const card = document.createElement('div');
    card.className = 'password-card';
    card.dataset.clipId = this.clip.id;

    const preview = this.clip.text.length > 80
      ? this.clip.text.substring(0, 80) + '...'
      : this.clip.text;

    card.innerHTML = `
      <div class="password-card-header">
        <div class="password-card-icon">📋</div>
        <div class="password-card-content">
          <div class="password-card-title">${this.escapeHtml(preview)}</div>
        </div>
      </div>
      <div class="password-card-actions">
        <button class="password-action-btn copy-clip" title="Copy to clipboard">📋</button>
        <button class="password-action-btn delete-clip" title="Delete">🗑️</button>
      </div>
    `;

    card.querySelector('.copy-clip').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.callbacks.onCopy) this.callbacks.onCopy(this.clip);
    });

    card.querySelector('.delete-clip').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.callbacks.onDelete) this.callbacks.onDelete(this.clip);
    });

    // Clicking the card body also copies it, for quick reuse
    card.addEventListener('click', () => {
      if (this.callbacks.onCopy) this.callbacks.onCopy(this.clip);
    });

    return card;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

module.exports = ClipCard;
