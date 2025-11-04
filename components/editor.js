// Reusable rich text editor component
class Editor {
  constructor(editorElement) {
    this.editor = editorElement;
    this.setupEditor();
  }

  setupEditor() {
    this.editor.contentEditable = true;
    this.editor.setAttribute('data-placeholder', 'Start typing your note...');
    
    // Handle paste to clean up formatting
    this.editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    // Handle link clicks with Cmd/Ctrl+Click
    this.editor.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        require('electron').shell.openExternal(e.target.href);
      }
    });

    // Handle checkbox clicks
    this.editor.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        // Checkbox state changed, trigger save
        if (this.onChange) {
          this.onChange();
        }
      }
    });

    // Auto-convert URLs to links and handle first line heading
    this.editor.addEventListener('input', (e) => {
      this.autoLinkUrls();
      this.autoConvertFirstLineToHeading();
      if (this.onChange) {
        this.onChange();
      }
    });
    
    // Handle keyboard shortcuts
    this.editor.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + B for bold
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        this.execCommand('bold');
      }
      // Cmd/Ctrl + I for italic
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        this.execCommand('italic');
      }
      // Cmd/Ctrl + U for underline
      if ((e.metaKey || e.ctrlKey) && e.key === 'u') {
        e.preventDefault();
        this.execCommand('underline');
      }
      
      // Handle Enter key in task lists
      if (e.key === 'Enter') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          let node = range.startContainer;
          
          // Find if we're in a task label
          if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
          }
          
          // Check if we're in a task-label
          if (node && node.classList && node.classList.contains('task-label')) {
            e.preventDefault();
            
            // Create a new task item
            const newContainer = document.createElement('div');
            newContainer.className = 'task-item';
            newContainer.style.display = 'flex';
            newContainer.style.alignItems = 'center';
            newContainer.style.marginBottom = '4px';
            
            const newCheckbox = document.createElement('input');
            newCheckbox.type = 'checkbox';
            newCheckbox.style.marginRight = '8px';
            
            const newLabel = document.createElement('span');
            newLabel.contentEditable = 'true';
            newLabel.className = 'task-label';
            // Add a zero-width space to make the span focusable
            newLabel.innerHTML = '&#8203;';
            
            newContainer.appendChild(newCheckbox);
            newContainer.appendChild(newLabel);
            
            // Insert the new task after the current task
            const currentTask = node.parentNode;
            if (currentTask && currentTask.parentNode) {
              currentTask.parentNode.insertBefore(newContainer, currentTask.nextSibling);
              
              // Move cursor to the new task - use setTimeout to ensure DOM is updated
              setTimeout(() => {
                newLabel.focus();
                const newRange = document.createRange();
                const textNode = newLabel.firstChild;
                if (textNode) {
                  newRange.setStart(textNode, 0);
                  newRange.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(newRange);
                }
              }, 0);
              
              if (this.onChange) {
                this.onChange();
              }
            }
          }
        }
      }
    });
  }

  autoLinkUrls() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      
      if (urlRegex.test(text)) {
        const newHtml = text.replace(urlRegex, '<a href="$1">$1</a>');
        const temp = document.createElement('div');
        temp.innerHTML = newHtml;
        
        while (temp.firstChild) {
          node.parentNode.insertBefore(temp.firstChild, node);
        }
        node.parentNode.removeChild(node);
      }
    }
  }

  autoConvertFirstLineToHeading() {
    // Get the first child element or text node
    const firstChild = this.editor.firstChild;
    
    if (!firstChild) return;
    
    // Check if it's a text node or a non-heading element
    const isTextNode = firstChild.nodeType === Node.TEXT_NODE;
    const isNotHeading = firstChild.nodeType === Node.ELEMENT_NODE && 
                         !firstChild.tagName.match(/^H[1-6]$/);
    
    if (isTextNode || isNotHeading) {
      const text = firstChild.textContent?.trim();
      
      // Only convert if there's text and it's not too long (reasonable heading length)
      if (text && text.length > 0 && text.length < 100) {
        // Check if this is the only content or if there's a line break after it
        const hasLineBreak = this.editor.innerHTML.includes('<br>') || 
                            this.editor.innerHTML.includes('</div>') ||
                            this.editor.innerHTML.includes('</p>') ||
                            this.editor.childNodes.length > 1;
        
        // Only convert to heading if it looks like a title (single line at the start)
        if (!hasLineBreak || this.editor.childNodes.length === 1) {
          // Save cursor position
          const selection = window.getSelection();
          const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
          const cursorOffset = range ? range.startOffset : 0;
          
          // Create h1 element
          const h1 = document.createElement('h1');
          h1.textContent = text;
          
          // Replace first child with h1
          this.editor.replaceChild(h1, firstChild);
          
          // Restore cursor position
          if (range && cursorOffset <= text.length) {
            const newRange = document.createRange();
            const textNode = h1.firstChild;
            if (textNode) {
              newRange.setStart(textNode, Math.min(cursorOffset, textNode.length));
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
            }
          }
        }
      }
    }
  }

  execCommand(command, value = null) {
    // Use document.execCommand for better browser compatibility
    try {
      document.execCommand(command, false, value);
    } catch (error) {
      console.error('execCommand failed:', error);
      // Fallback for some commands
      if (command === 'bold' || command === 'italic' || command === 'underline') {
        this.wrapSelection(command);
      }
    }
    this.editor.focus();
  }

  wrapSelection(command) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    if (!selectedText) return;
    
    let wrapper;
    switch (command) {
      case 'bold':
        wrapper = document.createElement('strong');
        break;
      case 'italic':
        wrapper = document.createElement('em');
        break;
      case 'underline':
        wrapper = document.createElement('u');
        break;
      default:
        return;
    }
    
    wrapper.textContent = selectedText;
    range.deleteContents();
    range.insertNode(wrapper);
    
    // Move cursor after the wrapper
    range.setStartAfter(wrapper);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  insertHeading(level) {
    // Ensure editor has focus first
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();
    
    // Create heading element
    const heading = document.createElement(`h${level}`);
    
    if (selectedText) {
      // If text is selected, wrap it in heading
      heading.textContent = selectedText;
      range.deleteContents();
      range.insertNode(heading);
    } else {
      // No selection - find the current line/block and convert it
      let currentNode = range.startContainer;
      
      // If we're in a text node, get its parent
      if (currentNode.nodeType === Node.TEXT_NODE) {
        currentNode = currentNode.parentNode;
      }
      
      // Find the block-level element containing the cursor
      let blockElement = currentNode;
      while (blockElement && blockElement !== this.editor && blockElement.parentNode !== this.editor) {
        blockElement = blockElement.parentNode;
      }
      
      // Check if we're in the first auto-generated H1
      const isFirstH1 = blockElement === this.editor.firstChild && 
                        blockElement.tagName === 'H1' &&
                        this.editor.childNodes.length > 1;
      
      if (isFirstH1) {
        // Don't format the auto-generated first line
        return;
      }
      
      if (blockElement && blockElement !== this.editor) {
        // Convert the current block to a heading
        const content = blockElement.textContent || 'Heading';
        heading.textContent = content;
        blockElement.parentNode.replaceChild(heading, blockElement);
      } else {
        // Insert new heading at cursor
        heading.textContent = 'Heading';
        range.insertNode(heading);
      }
    }
    
    // Add a line break after the heading if needed
    if (!heading.nextSibling) {
      const br = document.createElement('br');
      heading.parentNode.insertBefore(br, heading.nextSibling);
    }
    
    // Select the heading text for easy editing
    const newRange = document.createRange();
    newRange.selectNodeContents(heading);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  insertList(type) {
    // Ensure editor has focus first
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();
    
    // Create list
    const listTag = type === 'bullet' ? 'ul' : 'ol';
    const list = document.createElement(listTag);
    const listItem = document.createElement('li');
    
    if (selectedText) {
      // If text is selected, create list with selected text
      listItem.textContent = selectedText;
      range.deleteContents();
      list.appendChild(listItem);
      range.insertNode(list);
    } else {
      // No selection - find current line and convert it
      let currentNode = range.startContainer;
      
      if (currentNode.nodeType === Node.TEXT_NODE) {
        currentNode = currentNode.parentNode;
      }
      
      // Find the block-level element
      let blockElement = currentNode;
      while (blockElement && blockElement !== this.editor && blockElement.parentNode !== this.editor) {
        blockElement = blockElement.parentNode;
      }
      
      // Check if we're in the first auto-generated H1
      const isFirstH1 = blockElement === this.editor.firstChild && 
                        blockElement.tagName === 'H1' &&
                        this.editor.childNodes.length > 1;
      
      if (isFirstH1) {
        // Don't format the auto-generated first line
        return;
      }
      
      if (blockElement && blockElement !== this.editor && blockElement.textContent.trim()) {
        // Convert current line to list item
        listItem.textContent = blockElement.textContent;
        list.appendChild(listItem);
        blockElement.parentNode.replaceChild(list, blockElement);
      } else {
        // Insert new list at cursor
        listItem.textContent = 'List item';
        list.appendChild(listItem);
        range.insertNode(list);
      }
    }
    
    // Add a line break after the list if needed
    if (!list.nextSibling) {
      const br = document.createElement('br');
      list.parentNode.insertBefore(br, list.nextSibling);
    }
    
    // Move cursor into the list item
    const newRange = document.createRange();
    newRange.selectNodeContents(listItem);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  insertTaskList() {
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    
    // Get the selected content - need to handle HTML elements
    let lines = [];
    
    if (!range.collapsed) {
      // There's a selection - expand to include full elements if needed
      let startNode = range.startContainer;
      let endNode = range.endContainer;
      
      // If we're in a text node, get the parent element
      if (startNode.nodeType === Node.TEXT_NODE) {
        startNode = startNode.parentNode;
      }
      if (endNode.nodeType === Node.TEXT_NODE) {
        endNode = endNode.parentNode;
      }
      
      // Check if we're selecting from the first H1 heading
      const firstChild = this.editor.firstChild;
      const isSelectingFromH1 = firstChild && 
                                 firstChild.tagName === 'H1' && 
                                 (startNode === firstChild || startNode.parentNode === firstChild);
      
      // If selecting from H1, expand selection to include it fully
      if (isSelectingFromH1) {
        range.setStartBefore(firstChild);
      }
      
      const container = document.createElement('div');
      container.appendChild(range.cloneContents());
      
      // Extract text from each block-level element
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        null
      );
      
      let currentLine = '';
      let node;
      
      while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          currentLine += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();
          // Block-level elements indicate a new line
          if (['div', 'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tagName)) {
            if (currentLine.trim()) {
              lines.push(currentLine.trim());
            }
            currentLine = '';
          }
        }
      }
      
      // Add the last line if there's any content
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      
      // If we didn't find any lines, just use the plain text
      if (lines.length === 0) {
        const text = range.toString().trim();
        if (text) {
          lines = text.split('\n').filter(line => line.trim());
        }
      }
    }
    
    // Delete the selected content
    range.deleteContents();
    
    if (lines.length > 0) {
      // Create multiple tasks
      const fragment = document.createDocumentFragment();
      let lastLabel = null;
      
      lines.forEach((line, index) => {
        const container = document.createElement('div');
        container.className = 'task-item';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.marginBottom = '4px';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.marginRight = '8px';
        
        const label = document.createElement('span');
        label.textContent = line;
        label.contentEditable = 'true';
        label.className = 'task-label';
        
        container.appendChild(checkbox);
        container.appendChild(label);
        fragment.appendChild(container);
        
        if (index === lines.length - 1) {
          lastLabel = label;
        }
      });
      
      range.insertNode(fragment);
      
      // Move cursor to the end of the last task
      if (lastLabel) {
        const newRange = document.createRange();
        newRange.selectNodeContents(lastLabel);
        newRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    } else {
      // No selection - create a single task
      const container = document.createElement('div');
      container.className = 'task-item';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.marginBottom = '4px';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.marginRight = '8px';
      
      const label = document.createElement('span');
      label.textContent = 'Task item';
      label.contentEditable = 'true';
      label.className = 'task-label';
      
      container.appendChild(checkbox);
      container.appendChild(label);
      
      range.insertNode(container);
      
      // Move cursor into the label
      const newRange = document.createRange();
      newRange.selectNodeContents(label);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }
    
    this.editor.focus();
    if (this.onChange) {
      this.onChange();
    }
  }

  insertLink() {
    // Ensure editor has focus first
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) {
      const range = document.createRange();
      range.selectNodeContents(this.editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    const url = prompt('Enter URL:', 'https://');
    
    if (url && url.trim()) {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = selectedText || url;
      
      range.deleteContents();
      range.insertNode(link);
      
      // Move cursor after the link
      range.setStartAfter(link);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      
      this.editor.focus();
      
      if (this.onChange) {
        this.onChange();
      }
    }
  }

  insertCode() {
    // Ensure editor has focus first
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) {
      const range = document.createRange();
      range.selectNodeContents(this.editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    const code = document.createElement('code');
    code.textContent = selectedText || 'code';
    
    range.deleteContents();
    range.insertNode(code);
    
    // Select the code text for easy editing
    const newRange = document.createRange();
    newRange.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  insertCodeBlock() {
    // Ensure editor has focus first
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) {
      const range = document.createRange();
      range.selectNodeContents(this.editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    const range = selection.getRangeAt(0);
    
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = '// Code here';
    
    pre.appendChild(code);
    
    range.deleteContents();
    range.insertNode(pre);
    
    // Add a line break after the code block if needed
    const nextSibling = pre.nextSibling;
    if (!nextSibling) {
      const br = document.createElement('br');
      pre.parentNode.insertBefore(br, pre.nextSibling);
    }
    
    // Select the code content for easy editing
    const newRange = document.createRange();
    newRange.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  insertBlockquote() {
    // Ensure editor has focus first
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();
    
    const blockquote = document.createElement('blockquote');
    
    if (selectedText) {
      // If text is selected, wrap it in blockquote
      blockquote.textContent = selectedText;
      range.deleteContents();
      range.insertNode(blockquote);
    } else {
      // No selection - find current line and convert it
      let currentNode = range.startContainer;
      
      if (currentNode.nodeType === Node.TEXT_NODE) {
        currentNode = currentNode.parentNode;
      }
      
      // Find the block-level element
      let blockElement = currentNode;
      while (blockElement && blockElement !== this.editor && blockElement.parentNode !== this.editor) {
        blockElement = blockElement.parentNode;
      }
      
      // Check if we're in the first auto-generated H1
      const isFirstH1 = blockElement === this.editor.firstChild && 
                        blockElement.tagName === 'H1' &&
                        this.editor.childNodes.length > 1;
      
      if (isFirstH1) {
        // Don't format the auto-generated first line
        return;
      }
      
      if (blockElement && blockElement !== this.editor && blockElement.textContent.trim()) {
        // Convert current line to blockquote
        blockquote.textContent = blockElement.textContent;
        blockElement.parentNode.replaceChild(blockquote, blockElement);
      } else {
        // Insert new blockquote at cursor
        blockquote.textContent = 'Quote';
        range.insertNode(blockquote);
      }
    }
    
    // Add a line break after the blockquote if needed
    if (!blockquote.nextSibling) {
      const br = document.createElement('br');
      blockquote.parentNode.insertBefore(br, blockquote.nextSibling);
    }
    
    // Select the content for easy editing
    const newRange = document.createRange();
    newRange.selectNodeContents(blockquote);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  async insertImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        range.insertNode(img);
        range.collapse(false);
        
        this.editor.focus();
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  getContent() {
    return this.editor.innerHTML;
  }

  setContent(html) {
    this.editor.innerHTML = html;
  }

  clear() {
    this.editor.innerHTML = '';
  }

  focus() {
    this.editor.focus();
  }

  getTextContent() {
    return this.editor.textContent || '';
  }
}

module.exports = Editor;
