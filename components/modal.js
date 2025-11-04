// Reusable modal component
class Modal {
  constructor() {
    this.overlay = null;
    this.modal = null;
    this.onClose = null;
  }

  create(title, content, options = {}) {
    // Remove existing modal if any
    this.destroy();

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    
    // Create modal
    this.modal = document.createElement('div');
    this.modal.className = 'modal';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'modal-header';
    
    const titleEl = document.createElement('h2');
    titleEl.className = 'modal-title';
    titleEl.textContent = title;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => this.close();
    
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    
    // Create body
    const body = document.createElement('div');
    body.className = 'modal-body';
    
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else {
      body.appendChild(content);
    }
    
    this.modal.appendChild(header);
    this.modal.appendChild(body);
    this.overlay.appendChild(this.modal);
    
    // Add to document
    document.body.appendChild(this.overlay);
    
    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });
    
    // Close on escape key
    this.escapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
    
    return this.modal;
  }

  close() {
    if (this.onClose) {
      this.onClose();
    }
    this.destroy();
  }

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
    }
    this.overlay = null;
    this.modal = null;
  }
}

module.exports = Modal;
