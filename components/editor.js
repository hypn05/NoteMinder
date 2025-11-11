// Reusable rich text editor component
class Editor {
  constructor(editorElement) {
    this.editor = editorElement;
    this.setupEditor();
  }

  setupEditor() {
    this.editor.contentEditable = true;
    this.editor.setAttribute('data-placeholder', 'Start typing your note...');
    
    // Initialize undo/redo history
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistorySize = 100;
    this.isUndoRedoAction = false;
    
    // Save initial state
    this.saveState();
    
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
      
      // Save state for undo/redo (debounced)
      if (!this.isUndoRedoAction) {
        this.debouncedSaveState();
      }
      
      if (this.onChange) {
        this.onChange();
      }
    });
    
    // Handle keyboard shortcuts
    this.editor.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + Z for undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      
      // Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y for redo
      if ((e.metaKey || e.ctrlKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) {
        e.preventDefault();
        this.redo();
        return;
      }
      
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
      
      // Cmd/Ctrl + Shift + X for strikethrough
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'x') {
        e.preventDefault();
        this.toggleStrikethrough();
        return;
      }
      
      // Cmd/Ctrl + Shift + H for highlight
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'h') {
        e.preventDefault();
        this.toggleHighlight();
        return;
      }
      
      // Handle Markdown-style shortcuts
      // Auto-convert ** to bold
      if (e.key === ' ' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const textNode = range.startContainer;
          
          if (textNode.nodeType === Node.TEXT_NODE) {
            const text = textNode.textContent;
            const cursorPos = range.startOffset;
            
            // Check for **text** pattern (bold)
            const boldMatch = text.substring(0, cursorPos).match(/\*\*([^\*]+)\*\*$/);
            if (boldMatch) {
              e.preventDefault();
              const matchStart = cursorPos - boldMatch[0].length;
              const content = boldMatch[1];
              
              // Remove the markdown syntax
              const beforeText = text.substring(0, matchStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + content + afterText;
              
              // Create bold element
              const boldElement = document.createElement('strong');
              boldElement.textContent = content;
              
              // Split the text node and insert bold
              const newRange = document.createRange();
              newRange.setStart(textNode, beforeText.length);
              newRange.setEnd(textNode, beforeText.length + content.length);
              newRange.deleteContents();
              newRange.insertNode(boldElement);
              
              // Add space after
              const spaceNode = document.createTextNode(' ');
              boldElement.parentNode.insertBefore(spaceNode, boldElement.nextSibling);
              
              // Move cursor after space
              newRange.setStartAfter(spaceNode);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
            
            // Check for *text* pattern (italic)
            const italicMatch = text.substring(0, cursorPos).match(/\*([^\*]+)\*$/);
            if (italicMatch && !boldMatch) {
              e.preventDefault();
              const matchStart = cursorPos - italicMatch[0].length;
              const content = italicMatch[1];
              
              // Remove the markdown syntax
              const beforeText = text.substring(0, matchStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + content + afterText;
              
              // Create italic element
              const italicElement = document.createElement('em');
              italicElement.textContent = content;
              
              // Split the text node and insert italic
              const newRange = document.createRange();
              newRange.setStart(textNode, beforeText.length);
              newRange.setEnd(textNode, beforeText.length + content.length);
              newRange.deleteContents();
              newRange.insertNode(italicElement);
              
              // Add space after
              const spaceNode = document.createTextNode(' ');
              italicElement.parentNode.insertBefore(spaceNode, italicElement.nextSibling);
              
              // Move cursor after space
              newRange.setStartAfter(spaceNode);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
            
            // Check for ~~strikethrough~~ pattern
            const strikeMatch = text.substring(0, cursorPos).match(/~~([^~]+)~~$/);
            if (strikeMatch) {
              e.preventDefault();
              const matchStart = cursorPos - strikeMatch[0].length;
              const content = strikeMatch[1];
              
              // Remove the markdown syntax
              const beforeText = text.substring(0, matchStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + content + afterText;
              
              // Create strikethrough element
              const strikeElement = document.createElement('s');
              strikeElement.textContent = content;
              
              // Split the text node and insert strikethrough
              const newRange = document.createRange();
              newRange.setStart(textNode, beforeText.length);
              newRange.setEnd(textNode, beforeText.length + content.length);
              newRange.deleteContents();
              newRange.insertNode(strikeElement);
              
              // Add space after
              const spaceNode = document.createTextNode(' ');
              strikeElement.parentNode.insertBefore(spaceNode, strikeElement.nextSibling);
              
              // Move cursor after space
              newRange.setStartAfter(spaceNode);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
            
            // Check for ==highlight== pattern
            const highlightMatch = text.substring(0, cursorPos).match(/==([^=]+)==$/);
            if (highlightMatch) {
              e.preventDefault();
              const matchStart = cursorPos - highlightMatch[0].length;
              const content = highlightMatch[1];
              
              // Remove the markdown syntax
              const beforeText = text.substring(0, matchStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + content + afterText;
              
              // Create highlight element
              const markElement = document.createElement('mark');
              markElement.textContent = content;
              
              // Split the text node and insert highlight
              const newRange = document.createRange();
              newRange.setStart(textNode, beforeText.length);
              newRange.setEnd(textNode, beforeText.length + content.length);
              newRange.deleteContents();
              newRange.insertNode(markElement);
              
              // Add space after
              const spaceNode = document.createTextNode(' ');
              markElement.parentNode.insertBefore(spaceNode, markElement.nextSibling);
              
              // Move cursor after space
              newRange.setStartAfter(spaceNode);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
            
            // Check for `code` pattern
            const codeMatch = text.substring(0, cursorPos).match(/`([^`]+)`$/);
            if (codeMatch) {
              e.preventDefault();
              const matchStart = cursorPos - codeMatch[0].length;
              const content = codeMatch[1];
              
              // Remove the markdown syntax
              const beforeText = text.substring(0, matchStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + content + afterText;
              
              // Create code element
              const codeElement = document.createElement('code');
              codeElement.textContent = content;
              
              // Split the text node and insert code
              const newRange = document.createRange();
              newRange.setStart(textNode, beforeText.length);
              newRange.setEnd(textNode, beforeText.length + content.length);
              newRange.deleteContents();
              newRange.insertNode(codeElement);
              
              // Add space after
              const spaceNode = document.createTextNode(' ');
              codeElement.parentNode.insertBefore(spaceNode, codeElement.nextSibling);
              
              // Move cursor after space
              newRange.setStartAfter(spaceNode);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
          }
        }
      }
      
      // Handle markdown shortcuts at start of line
      if (e.key === ' ' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const textNode = range.startContainer;
          
          if (textNode.nodeType === Node.TEXT_NODE) {
            const text = textNode.textContent;
            const cursorPos = range.startOffset;
            const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
            const lineText = text.substring(lineStart, cursorPos);
            
            // Check for heading patterns (# to ######)
            const headingMatch = lineText.match(/^(#{1,6})$/);
            if (headingMatch) {
              e.preventDefault();
              const level = headingMatch[1].length;
              
              // Remove the # characters
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              
              // Get the parent node to replace
              let parentNode = textNode.parentNode;
              if (parentNode === this.editor) {
                // Create heading
                const heading = document.createElement(`h${level}`);
                heading.textContent = '';
                
                // Replace text node
                textNode.textContent = beforeText + afterText;
                parentNode.insertBefore(heading, textNode);
                
                // Move cursor into heading
                const newRange = document.createRange();
                newRange.setStart(heading, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                this.saveState();
                if (this.onChange) this.onChange();
              }
              return;
            }
            
            // Check for bullet list pattern (- or *)
            const bulletMatch = lineText.match(/^[-*]$/);
            if (bulletMatch) {
              e.preventDefault();
              
              // Remove the - or * character
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + afterText;
              
              // Create list
              const list = document.createElement('ul');
              const listItem = document.createElement('li');
              listItem.textContent = '';
              list.appendChild(listItem);
              
              // Insert list
              const parentNode = textNode.parentNode;
              if (parentNode === this.editor || parentNode.parentNode === this.editor) {
                const insertPoint = parentNode === this.editor ? textNode : parentNode;
                insertPoint.parentNode.insertBefore(list, insertPoint);
                
                // Move cursor into list item
                const newRange = document.createRange();
                newRange.setStart(listItem, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                this.saveState();
                if (this.onChange) this.onChange();
              }
              return;
            }
            
            // Check for numbered list pattern (1. or 1))
            const numberedMatch = lineText.match(/^(\d+)[.)]$/);
            if (numberedMatch) {
              e.preventDefault();
              
              // Remove the number and punctuation
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + afterText;
              
              // Create list
              const list = document.createElement('ol');
              const listItem = document.createElement('li');
              listItem.textContent = '';
              list.appendChild(listItem);
              
              // Insert list
              const parentNode = textNode.parentNode;
              if (parentNode === this.editor || parentNode.parentNode === this.editor) {
                const insertPoint = parentNode === this.editor ? textNode : parentNode;
                insertPoint.parentNode.insertBefore(list, insertPoint);
                
                // Move cursor into list item
                const newRange = document.createRange();
                newRange.setStart(listItem, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                this.saveState();
                if (this.onChange) this.onChange();
              }
              return;
            }
            
            // Check for checkbox pattern ([ ] or [x])
            const checkboxMatch = lineText.match(/^\[([ x])\]$/);
            if (checkboxMatch) {
              e.preventDefault();
              const isChecked = checkboxMatch[1] === 'x';
              
              // Remove the checkbox syntax
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + afterText;
              
              // Create task item
              const container = document.createElement('div');
              container.className = 'task-item';
              container.style.display = 'flex';
              container.style.alignItems = 'center';
              container.style.marginBottom = '4px';
              
              const checkbox = document.createElement('input');
              checkbox.type = 'checkbox';
              checkbox.checked = isChecked;
              checkbox.style.marginRight = '8px';
              
              const label = document.createElement('span');
              label.contentEditable = 'true';
              label.className = 'task-label';
              label.innerHTML = '&#8203;';
              
              container.appendChild(checkbox);
              container.appendChild(label);
              
              // Insert task
              const parentNode = textNode.parentNode;
              if (parentNode === this.editor || parentNode.parentNode === this.editor) {
                const insertPoint = parentNode === this.editor ? textNode : parentNode;
                insertPoint.parentNode.insertBefore(container, insertPoint);
                
                // Move cursor into label
                setTimeout(() => {
                  label.focus();
                  const newRange = document.createRange();
                  const textNode = label.firstChild;
                  if (textNode) {
                    newRange.setStart(textNode, 0);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                  }
                }, 0);
                
                this.saveState();
                if (this.onChange) this.onChange();
              }
              return;
            }
            
            // Check for blockquote pattern (>)
            const blockquoteMatch = lineText.match(/^>$/);
            if (blockquoteMatch) {
              e.preventDefault();
              
              // Remove the > character
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + afterText;
              
              // Create blockquote
              const blockquote = document.createElement('blockquote');
              blockquote.textContent = '';
              
              // Insert blockquote
              const parentNode = textNode.parentNode;
              if (parentNode === this.editor || parentNode.parentNode === this.editor) {
                const insertPoint = parentNode === this.editor ? textNode : parentNode;
                insertPoint.parentNode.insertBefore(blockquote, insertPoint);
                
                // Move cursor into blockquote
                const newRange = document.createRange();
                newRange.setStart(blockquote, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                this.saveState();
                if (this.onChange) this.onChange();
              }
              return;
            }
            
            // Check for horizontal rule pattern (---)
            const hrMatch = lineText.match(/^---$/);
            if (hrMatch) {
              e.preventDefault();
              
              // Remove the --- characters
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + afterText;
              
              // Create horizontal rule
              const hr = document.createElement('hr');
              
              // Insert hr
              const parentNode = textNode.parentNode;
              if (parentNode === this.editor || parentNode.parentNode === this.editor) {
                const insertPoint = parentNode === this.editor ? textNode : parentNode;
                insertPoint.parentNode.insertBefore(hr, insertPoint);
                
                // Add line break after hr
                const br = document.createElement('br');
                hr.parentNode.insertBefore(br, hr.nextSibling);
                
                // Move cursor after hr
                const newRange = document.createRange();
                newRange.setStartAfter(br);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                this.saveState();
                if (this.onChange) this.onChange();
              }
              return;
            }
          }
        }
      }
      
      // Handle Tab key for list indentation
      if (e.key === 'Tab') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          let node = range.startContainer;
          
          if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
          }
          
          // Check if we're in a list item
          let listItem = node;
          while (listItem && listItem !== this.editor && listItem.tagName !== 'LI') {
            listItem = listItem.parentNode;
          }
          
          if (listItem && listItem.tagName === 'LI') {
            e.preventDefault();
            
            if (e.shiftKey) {
              // Shift+Tab: Outdent
              this.outdentListItem(listItem);
            } else {
              // Tab: Indent
              this.indentListItem(listItem);
            }
            return;
          }
        }
      }
      
      // Handle Enter key in lists and task lists
      if (e.key === 'Enter') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          let node = range.startContainer;
          
          // Find if we're in a task label
          if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
          }
          
          // Check for horizontal rule pattern (---) before other checks
          if (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && node.textContent)) {
            const textNode = node.nodeType === Node.TEXT_NODE ? node : node.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
              const text = textNode.textContent;
              const cursorPos = range.startOffset;
              const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
              const lineText = text.substring(lineStart, cursorPos).trim();
              
              // Check for horizontal rule pattern (---)
              if (lineText === '---') {
                e.preventDefault();
                
                // Remove the --- characters
                const beforeText = text.substring(0, lineStart);
                const afterText = text.substring(cursorPos);
                textNode.textContent = beforeText + afterText;
                
                // Create horizontal rule
                const hr = document.createElement('hr');
                
                // Insert hr
                const parentNode = textNode.parentNode;
                if (parentNode === this.editor || parentNode.parentNode === this.editor) {
                  const insertPoint = parentNode === this.editor ? textNode : parentNode;
                  insertPoint.parentNode.insertBefore(hr, insertPoint);
                  
                  // Add line break after hr
                  const br = document.createElement('br');
                  hr.parentNode.insertBefore(br, hr.nextSibling);
                  
                  // Move cursor after hr
                  const newRange = document.createRange();
                  newRange.setStartAfter(br);
                  newRange.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(newRange);
                  
                  this.saveState();
                  if (this.onChange) this.onChange();
                }
                return;
              }
            }
          }
          
          // Check if we're in a regular list item
          let listItem = node;
          while (listItem && listItem !== this.editor && listItem.tagName !== 'LI') {
            listItem = listItem.parentNode;
          }
          
          if (listItem && listItem.tagName === 'LI') {
            // Check if the list item is empty
            if (!listItem.textContent.trim()) {
              e.preventDefault();
              
              // If empty, exit the list
              const list = listItem.parentNode;
              const isNested = list.parentNode.tagName === 'LI';
              
              if (isNested) {
                // If in nested list, outdent
                this.outdentListItem(listItem);
              } else {
                // If at top level, exit list completely
                listItem.parentNode.removeChild(listItem);
                
                // Add a new line after the list
                const br = document.createElement('br');
                list.parentNode.insertBefore(br, list.nextSibling);
                
                // Move cursor to the new line
                const newRange = document.createRange();
                newRange.setStartAfter(br);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
              }
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
          }
          
          // Check if we're in a task-label
          if (node && node.classList && node.classList.contains('task-label')) {
            // Check if task label is empty
            if (!node.textContent.trim()) {
              e.preventDefault();
              
              // Remove the empty task item
              const taskItem = node.parentNode;
              if (taskItem && taskItem.parentNode) {
                taskItem.parentNode.removeChild(taskItem);
                
                // Add a new line
                const br = document.createElement('br');
                const insertPoint = taskItem.nextSibling || taskItem.parentNode;
                if (insertPoint.parentNode) {
                  insertPoint.parentNode.insertBefore(br, insertPoint);
                } else {
                  this.editor.appendChild(br);
                }
                
                // Move cursor to the new line
                const newRange = document.createRange();
                newRange.setStartAfter(br);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
              }
              
              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }
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
    
    // Check if we're already in a list of this type - if so, toggle it off
    let currentNode = range.startContainer;
    if (currentNode.nodeType === Node.TEXT_NODE) {
      currentNode = currentNode.parentNode;
    }
    
    // Find if we're in a list
    let listElement = currentNode;
    while (listElement && listElement !== this.editor) {
      if (listElement.tagName === 'UL' || listElement.tagName === 'OL') {
        break;
      }
      listElement = listElement.parentNode;
    }
    
    const listTag = type === 'bullet' ? 'ul' : 'ol';
    const isInSameTypeList = listElement && listElement.tagName === listTag.toUpperCase();
    
    if (isInSameTypeList) {
      // Toggle off: Convert list back to normal text
      this.removeList(listElement);
      return;
    }
    
    // Get selected lines
    const lines = this.getSelectedLines(range);
    
    // Create list
    const list = document.createElement(listTag);
    
    if (lines.length > 0) {
      // Create list items for each line
      lines.forEach(line => {
        const listItem = document.createElement('li');
        listItem.textContent = line;
        list.appendChild(listItem);
      });
      
      // Delete selected content and insert list
      range.deleteContents();
      range.insertNode(list);
      
      // Move cursor to end of last item
      const lastItem = list.lastChild;
      const newRange = document.createRange();
      newRange.selectNodeContents(lastItem);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else {
      // No selection - find current line and convert it
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
      
      const listItem = document.createElement('li');
      
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
      
      // Move cursor into the list item
      const newRange = document.createRange();
      newRange.selectNodeContents(listItem);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }
    
    // Add a line break after the list if needed
    if (!list.nextSibling) {
      const br = document.createElement('br');
      list.parentNode.insertBefore(br, list.nextSibling);
    }
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  insertTaskList() {
    this.editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    
    // Check if we're already in a task list - if so, toggle it off
    let currentNode = range.startContainer;
    if (currentNode.nodeType === Node.TEXT_NODE) {
      currentNode = currentNode.parentNode;
    }
    
    // Find if we're in a task-item
    let taskItem = currentNode;
    while (taskItem && taskItem !== this.editor) {
      if (taskItem.classList && taskItem.classList.contains('task-item')) {
        break;
      }
      taskItem = taskItem.parentNode;
    }
    
    if (taskItem && taskItem.classList.contains('task-item')) {
      // Toggle off: Convert task list back to normal text
      this.removeTaskList(taskItem);
      return;
    }
    
    // Get selected lines
    const lines = this.getSelectedLines(range);
    
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
    this.saveState();
    
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

  insertTable(rows = 3, cols = 3) {
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
    
    // Create table wrapper
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    tableWrapper.style.position = 'relative';
    tableWrapper.style.marginTop = '8px';
    tableWrapper.style.marginBottom = '8px';
    
    // Create table
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';
    table.setAttribute('contenteditable', 'false');
    
    const tbody = document.createElement('tbody');
    
    // Create rows
    for (let i = 0; i < rows; i++) {
      const tr = document.createElement('tr');
      
      // Create cells
      for (let j = 0; j < cols; j++) {
        const td = document.createElement(i === 0 ? 'th' : 'td');
        td.contentEditable = 'true';
        td.style.border = '1px solid var(--border-color, #ddd)';
        td.style.padding = '8px';
        td.style.minWidth = '100px';
        td.textContent = i === 0 ? `Header ${j + 1}` : '';
        
        // Add keyboard navigation
        td.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const nextCell = e.shiftKey ? this.getPreviousCell(td) : this.getNextCell(td);
            if (nextCell) {
              nextCell.focus();
              // Select all content in the cell
              const range = document.createRange();
              range.selectNodeContents(nextCell);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        });
        
        // Add context menu on right-click
        td.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showTableContextMenu(e, td, table);
        });
        
        tr.appendChild(td);
      }
      
      tbody.appendChild(tr);
    }
    
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    
    // Insert table wrapper
    range.deleteContents();
    range.insertNode(tableWrapper);
    
    // Add line break after table
    const br = document.createElement('br');
    tableWrapper.parentNode.insertBefore(br, tableWrapper.nextSibling);
    
    // Focus first cell
    const firstCell = table.querySelector('th, td');
    if (firstCell) {
      setTimeout(() => {
        firstCell.focus();
        const newRange = document.createRange();
        newRange.selectNodeContents(firstCell);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }, 0);
    }
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  showTableContextMenu(event, cell, table) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.table-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }
    
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'table-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.backgroundColor = 'var(--bg-primary, #fff)';
    menu.style.border = '1px solid var(--border-color, #ddd)';
    menu.style.borderRadius = '4px';
    menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    menu.style.zIndex = '10000';
    menu.style.minWidth = '180px';
    menu.style.padding = '4px 0';
    
    const menuItems = [
      { label: 'Insert Row Above', action: () => this.insertRowAbove(cell, table) },
      { label: 'Insert Row Below', action: () => this.insertRowBelow(cell, table) },
      { label: 'Insert Column Left', action: () => this.insertColumnLeft(cell, table) },
      { label: 'Insert Column Right', action: () => this.insertColumnRight(cell, table) },
      { label: '---', action: null },
      { label: 'Delete Row', action: () => this.deleteRow(cell, table) },
      { label: 'Delete Column', action: () => this.deleteColumn(cell, table) },
      { label: 'Delete Table', action: () => this.deleteTable(table) }
    ];
    
    menuItems.forEach(item => {
      if (item.label === '---') {
        const separator = document.createElement('div');
        separator.style.height = '1px';
        separator.style.backgroundColor = 'var(--border-color, #ddd)';
        separator.style.margin = '4px 0';
        menu.appendChild(separator);
      } else {
        const menuItem = document.createElement('div');
        menuItem.textContent = item.label;
        menuItem.style.padding = '8px 16px';
        menuItem.style.cursor = 'pointer';
        menuItem.style.fontSize = '13px';
        menuItem.style.color = 'var(--text-primary, #333)';
        
        menuItem.addEventListener('mouseenter', () => {
          menuItem.style.backgroundColor = 'var(--bg-secondary, #f5f5f5)';
        });
        
        menuItem.addEventListener('mouseleave', () => {
          menuItem.style.backgroundColor = 'transparent';
        });
        
        menuItem.addEventListener('click', () => {
          item.action();
          menu.remove();
        });
        
        menu.appendChild(menuItem);
      }
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

  insertRowAbove(cell, table) {
    const row = cell.parentElement;
    const newRow = document.createElement('tr');
    const cellCount = row.children.length;
    
    for (let i = 0; i < cellCount; i++) {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.style.border = '1px solid var(--border-color, #ddd)';
      td.style.padding = '8px';
      td.style.minWidth = '100px';
      
      // Add keyboard navigation
      td.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const nextCell = e.shiftKey ? this.getPreviousCell(td) : this.getNextCell(td);
          if (nextCell) {
            nextCell.focus();
            const range = document.createRange();
            range.selectNodeContents(nextCell);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
      
      // Add context menu
      td.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showTableContextMenu(e, td, table);
      });
      
      newRow.appendChild(td);
    }
    
    row.parentElement.insertBefore(newRow, row);
    this.saveState();
    if (this.onChange) this.onChange();
  }

  insertRowBelow(cell, table) {
    const row = cell.parentElement;
    const newRow = document.createElement('tr');
    const cellCount = row.children.length;
    
    for (let i = 0; i < cellCount; i++) {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.style.border = '1px solid var(--border-color, #ddd)';
      td.style.padding = '8px';
      td.style.minWidth = '100px';
      
      // Add keyboard navigation
      td.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const nextCell = e.shiftKey ? this.getPreviousCell(td) : this.getNextCell(td);
          if (nextCell) {
            nextCell.focus();
            const range = document.createRange();
            range.selectNodeContents(nextCell);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
      
      // Add context menu
      td.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showTableContextMenu(e, td, table);
      });
      
      newRow.appendChild(td);
    }
    
    row.parentElement.insertBefore(newRow, row.nextSibling);
    this.saveState();
    if (this.onChange) this.onChange();
  }

  insertColumnLeft(cell, table) {
    const cellIndex = Array.from(cell.parentElement.children).indexOf(cell);
    const rows = table.querySelectorAll('tr');
    
    rows.forEach((row, rowIndex) => {
      const newCell = document.createElement(rowIndex === 0 ? 'th' : 'td');
      newCell.contentEditable = 'true';
      newCell.style.border = '1px solid var(--border-color, #ddd)';
      newCell.style.padding = '8px';
      newCell.style.minWidth = '100px';
      
      if (rowIndex === 0) {
        newCell.textContent = 'Header';
      }
      
      // Add keyboard navigation
      newCell.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const nextCell = e.shiftKey ? this.getPreviousCell(newCell) : this.getNextCell(newCell);
          if (nextCell) {
            nextCell.focus();
            const range = document.createRange();
            range.selectNodeContents(nextCell);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
      
      // Add context menu
      newCell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showTableContextMenu(e, newCell, table);
      });
      
      row.insertBefore(newCell, row.children[cellIndex]);
    });
    
    this.saveState();
    if (this.onChange) this.onChange();
  }

  insertColumnRight(cell, table) {
    const cellIndex = Array.from(cell.parentElement.children).indexOf(cell);
    const rows = table.querySelectorAll('tr');
    
    rows.forEach((row, rowIndex) => {
      const newCell = document.createElement(rowIndex === 0 ? 'th' : 'td');
      newCell.contentEditable = 'true';
      newCell.style.border = '1px solid var(--border-color, #ddd)';
      newCell.style.padding = '8px';
      newCell.style.minWidth = '100px';
      
      if (rowIndex === 0) {
        newCell.textContent = 'Header';
      }
      
      // Add keyboard navigation
      newCell.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const nextCell = e.shiftKey ? this.getPreviousCell(newCell) : this.getNextCell(newCell);
          if (nextCell) {
            nextCell.focus();
            const range = document.createRange();
            range.selectNodeContents(nextCell);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
      
      // Add context menu
      newCell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showTableContextMenu(e, newCell, table);
      });
      
      const nextCell = row.children[cellIndex + 1];
      row.insertBefore(newCell, nextCell);
    });
    
    this.saveState();
    if (this.onChange) this.onChange();
  }

  deleteRow(cell, table) {
    const row = cell.parentElement;
    const tbody = row.parentElement;
    
    // Don't delete if it's the only row
    if (tbody.children.length <= 1) {
      alert('Cannot delete the only row in the table');
      return;
    }
    
    row.remove();
    this.saveState();
    if (this.onChange) this.onChange();
  }

  deleteColumn(cell, table) {
    const cellIndex = Array.from(cell.parentElement.children).indexOf(cell);
    const rows = table.querySelectorAll('tr');
    
    // Don't delete if it's the only column
    if (rows[0].children.length <= 1) {
      alert('Cannot delete the only column in the table');
      return;
    }
    
    rows.forEach(row => {
      if (row.children[cellIndex]) {
        row.children[cellIndex].remove();
      }
    });
    
    this.saveState();
    if (this.onChange) this.onChange();
  }

  deleteTable(table) {
    const wrapper = table.parentElement;
    if (wrapper && wrapper.className === 'table-wrapper') {
      wrapper.remove();
    } else {
      table.remove();
    }
    
    this.saveState();
    if (this.onChange) this.onChange();
  }

  getNextCell(currentCell) {
    // Get next cell in the table
    let nextCell = currentCell.nextElementSibling;
    if (nextCell) return nextCell;
    
    // Move to next row
    const currentRow = currentCell.parentElement;
    const nextRow = currentRow.nextElementSibling;
    if (nextRow) {
      return nextRow.querySelector('th, td');
    }
    
    return null;
  }

  getPreviousCell(currentCell) {
    // Get previous cell in the table
    let prevCell = currentCell.previousElementSibling;
    if (prevCell) return prevCell;
    
    // Move to previous row
    const currentRow = currentCell.parentElement;
    const prevRow = currentRow.previousElementSibling;
    if (prevRow) {
      const cells = prevRow.querySelectorAll('th, td');
      return cells[cells.length - 1];
    }
    
    return null;
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

  // Helper method to extract selected lines
  getSelectedLines(range) {
    const lines = [];
    
    if (range.collapsed) {
      return lines;
    }
    
    // Expand selection to include full elements if needed
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
        lines.push(...text.split('\n').filter(line => line.trim()));
      }
    }
    
    return lines;
  }

  // Undo/Redo functionality
  saveState() {
    const state = {
      content: this.editor.innerHTML,
      selection: this.saveSelection()
    };
    
    // Don't save if content hasn't changed
    if (this.undoStack.length > 0) {
      const lastState = this.undoStack[this.undoStack.length - 1];
      if (lastState.content === state.content) {
        return;
      }
    }
    
    this.undoStack.push(state);
    
    // Limit stack size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    
    // Clear redo stack when new action is performed
    this.redoStack = [];
  }

  debouncedSaveState() {
    clearTimeout(this.saveStateTimeout);
    this.saveStateTimeout = setTimeout(() => {
      this.saveState();
    }, 500);
  }

  saveSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    
    const range = selection.getRangeAt(0);
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(this.editor);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    
    return {
      start: start,
      end: start + range.toString().length
    };
  }

  restoreSelection(savedSelection) {
    if (!savedSelection) return;
    
    const charIndex = { count: 0 };
    const range = document.createRange();
    range.setStart(this.editor, 0);
    range.collapse(true);
    
    const nodeStack = [this.editor];
    let node;
    let foundStart = false;
    let stop = false;
    
    while (!stop && (node = nodeStack.pop())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const nextCharIndex = charIndex.count + node.length;
        if (!foundStart && savedSelection.start >= charIndex.count && savedSelection.start <= nextCharIndex) {
          range.setStart(node, savedSelection.start - charIndex.count);
          foundStart = true;
        }
        if (foundStart && savedSelection.end >= charIndex.count && savedSelection.end <= nextCharIndex) {
          range.setEnd(node, savedSelection.end - charIndex.count);
          stop = true;
        }
        charIndex.count = nextCharIndex;
      } else {
        let i = node.childNodes.length;
        while (i--) {
          nodeStack.push(node.childNodes[i]);
        }
      }
    }
    
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  undo() {
    if (this.undoStack.length <= 1) return; // Keep at least one state
    
    // Save current state to redo stack
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);
    
    // Restore previous state
    const previousState = this.undoStack[this.undoStack.length - 1];
    this.isUndoRedoAction = true;
    this.editor.innerHTML = previousState.content;
    this.restoreSelection(previousState.selection);
    this.isUndoRedoAction = false;
    
    if (this.onChange) {
      this.onChange();
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;
    
    // Get state from redo stack
    const state = this.redoStack.pop();
    this.undoStack.push(state);
    
    // Restore state
    this.isUndoRedoAction = true;
    this.editor.innerHTML = state.content;
    this.restoreSelection(state.selection);
    this.isUndoRedoAction = false;
    
    if (this.onChange) {
      this.onChange();
    }
  }

  // Remove list formatting and convert back to normal text
  removeList(listElement) {
    const selection = window.getSelection();
    const fragment = document.createDocumentFragment();
    
    // Extract text from all list items
    const items = listElement.querySelectorAll('li');
    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.textContent = item.textContent;
      fragment.appendChild(div);
      
      // Add line break between items except for the last one
      if (index < items.length - 1) {
        fragment.appendChild(document.createElement('br'));
      }
    });
    
    // Replace the list with the text
    listElement.parentNode.replaceChild(fragment, listElement);
    
    // Try to restore selection
    if (fragment.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(fragment.firstChild);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  // Remove task list formatting and convert back to normal text
  removeTaskList(taskItem) {
    const selection = window.getSelection();
    
    // Find all consecutive task items
    const taskItems = [];
    let current = taskItem;
    
    // Go backwards to find the start
    while (current && current.previousSibling && 
           current.previousSibling.classList && 
           current.previousSibling.classList.contains('task-item')) {
      current = current.previousSibling;
    }
    
    // Collect all task items
    while (current && current.classList && current.classList.contains('task-item')) {
      taskItems.push(current);
      current = current.nextSibling;
    }
    
    // Convert to normal text
    const fragment = document.createDocumentFragment();
    taskItems.forEach((item, index) => {
      const label = item.querySelector('.task-label');
      if (label) {
        const div = document.createElement('div');
        div.textContent = label.textContent;
        fragment.appendChild(div);
        
        if (index < taskItems.length - 1) {
          fragment.appendChild(document.createElement('br'));
        }
      }
    });
    
    // Replace the first task item with the fragment
    if (taskItems.length > 0) {
      taskItems[0].parentNode.replaceChild(fragment, taskItems[0]);
      
      // Remove the rest
      for (let i = 1; i < taskItems.length; i++) {
        if (taskItems[i].parentNode) {
          taskItems[i].parentNode.removeChild(taskItems[i]);
        }
      }
    }
    
    // Try to restore selection
    if (fragment.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(fragment.firstChild);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  // Indent list item (Tab)
  indentListItem(listItem) {
    const previousSibling = listItem.previousElementSibling;
    
    if (!previousSibling || previousSibling.tagName !== 'LI') {
      // Can't indent if there's no previous item
      return;
    }
    
    // Get the parent list type
    const parentList = listItem.parentNode;
    const listType = parentList.tagName.toLowerCase();
    
    // Check if previous sibling already has a nested list
    let nestedList = null;
    for (let child of previousSibling.childNodes) {
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        nestedList = child;
        break;
      }
    }
    
    // Create nested list if it doesn't exist
    if (!nestedList) {
      nestedList = document.createElement(listType);
      previousSibling.appendChild(nestedList);
    }
    
    // Move the current item into the nested list
    nestedList.appendChild(listItem);
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  // Outdent list item (Shift+Tab)
  outdentListItem(listItem) {
    const parentList = listItem.parentNode;
    const grandparentItem = parentList.parentNode;
    
    // Check if we're in a nested list
    if (!grandparentItem || grandparentItem.tagName !== 'LI') {
      // Already at top level, can't outdent further
      return;
    }
    
    const grandparentList = grandparentItem.parentNode;
    
    // Move the item after its grandparent
    grandparentList.insertBefore(listItem, grandparentItem.nextSibling);
    
    // If the parent list is now empty, remove it
    if (parentList.children.length === 0) {
      parentList.parentNode.removeChild(parentList);
    }
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  // Toggle strikethrough formatting
  toggleStrikethrough() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    if (!selectedText) return;
    
    // Check if already strikethrough
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
    }
    
    let strikeElement = node;
    while (strikeElement && strikeElement !== this.editor) {
      if (strikeElement.tagName === 'S' || strikeElement.tagName === 'STRIKE' || strikeElement.tagName === 'DEL') {
        // Remove strikethrough
        const parent = strikeElement.parentNode;
        while (strikeElement.firstChild) {
          parent.insertBefore(strikeElement.firstChild, strikeElement);
        }
        parent.removeChild(strikeElement);
        this.saveState();
        if (this.onChange) this.onChange();
        return;
      }
      strikeElement = strikeElement.parentNode;
    }
    
    // Add strikethrough
    const strike = document.createElement('s');
    strike.textContent = selectedText;
    range.deleteContents();
    range.insertNode(strike);
    
    // Select the strikethrough text
    const newRange = document.createRange();
    newRange.selectNodeContents(strike);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }

  // Toggle highlight formatting
  toggleHighlight() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    if (!selectedText) return;
    
    // Check if already highlighted
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
    }
    
    let markElement = node;
    while (markElement && markElement !== this.editor) {
      if (markElement.tagName === 'MARK') {
        // Remove highlight
        const parent = markElement.parentNode;
        while (markElement.firstChild) {
          parent.insertBefore(markElement.firstChild, markElement);
        }
        parent.removeChild(markElement);
        this.saveState();
        if (this.onChange) this.onChange();
        return;
      }
      markElement = markElement.parentNode;
    }
    
    // Add highlight
    const mark = document.createElement('mark');
    mark.textContent = selectedText;
    range.deleteContents();
    range.insertNode(mark);
    
    // Select the highlighted text
    const newRange = document.createRange();
    newRange.selectNodeContents(mark);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    this.editor.focus();
    this.saveState();
    
    if (this.onChange) {
      this.onChange();
    }
  }
}

module.exports = Editor;
