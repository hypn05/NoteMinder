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
    
    // Handle paste: preserve common formatting (bold, italic, links, lists,
    // headings, code, blockquote) but strip anything that could carry scripts,
    // remote loads, or visual baggage (styles, classes, fonts, dangerous URLs).
    this.editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      if (html && html.trim()) {
        const safe = Editor.sanitizePastedHtml(html);
        document.execCommand('insertHTML', false, safe);
      } else {
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }
    });

    // Handle link clicks with Cmd/Ctrl+Click
    this.editor.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        require('electron').shell.openExternal(e.target.href);
        return;
      }

      // Clicking anywhere on a task-item row (other than the checkbox itself)
      // should focus the label and place the caret at the end. Without this,
      // clicking the empty space to the right of a short label does nothing
      // visible because the span only fills its content width.
      const taskItem = e.target.closest && e.target.closest('.task-item');
      if (taskItem && e.target.tagName !== 'INPUT') {
        const label = taskItem.querySelector('.task-label');
        if (label && e.target !== label && !label.contains(e.target)) {
          e.preventDefault();
          label.focus();
          const sel = window.getSelection();
          const r = document.createRange();
          r.selectNodeContents(label);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
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

    // Auto-convert URLs to links on input.
    // Note: first-line-as-H1 auto-conversion was removed — title is now a
    // separate input above the editor, so the body has no implicit heading.
    this.editor.addEventListener('input', (e) => {
      this.autoLinkUrls();

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

      // Cmd/Ctrl + Alt + 0/1/2/3 — 0 reverts to normal paragraph, 1/2/3 headings
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey) {
        if (e.key === '0') { e.preventDefault(); this.clearBlockFormat(); return; }
        if (e.key === '1') { e.preventDefault(); this.insertHeading(1); return; }
        if (e.key === '2') { e.preventDefault(); this.insertHeading(2); return; }
        if (e.key === '3') { e.preventDefault(); this.insertHeading(3); return; }
      }

      // Cmd/Ctrl + Shift + 7/8/9 for lists (ordered / unordered / task)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        if (e.key === '7') { e.preventDefault(); this.insertList('numbered'); return; }
        if (e.key === '8') { e.preventDefault(); this.insertList('bullet'); return; }
        if (e.key === '9') { e.preventDefault(); this.insertTaskList(); return; }
      }

      // Cmd/Ctrl + K to insert link
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'k') {
        e.preventDefault();
        this.insertLink();
        return;
      }

      // Cmd/Ctrl + E for inline code
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'e') {
        e.preventDefault();
        this.insertCode();
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
            
            // All the start-of-line block shortcuts share the same shape:
            //  1. Match a marker (#, -, *, +, 1., 1), >) at the start of the line
            //  2. Strip the marker characters from the text node
            //  3. Delegate to insertHeading / insertList / insertBlockquote,
            //     which now use document.execCommand and handle every nesting
            //     case correctly.
            const stripMarker = (textNode, lineStart, cursorPos) => {
              const t = textNode.textContent;
              textNode.textContent = t.substring(0, lineStart) + t.substring(cursorPos);
              // Place cursor where the marker used to be.
              const r = document.createRange();
              r.setStart(textNode, lineStart);
              r.collapse(true);
              selection.removeAllRanges();
              selection.addRange(r);
            };

            // # to ######  → headings
            const headingMatch = lineText.match(/^(#{1,6})$/);
            if (headingMatch) {
              e.preventDefault();
              stripMarker(textNode, lineStart, cursorPos);
              this.insertHeading(headingMatch[1].length);
              return;
            }

            // -, *, +  → bullet list
            const bulletMatch = lineText.match(/^[-*+]$/);
            if (bulletMatch) {
              e.preventDefault();
              stripMarker(textNode, lineStart, cursorPos);
              this.insertList('bullet');
              return;
            }

            // 1. or 1)  → numbered list
            const numberedMatch = lineText.match(/^(\d+)[.)]$/);
            if (numberedMatch) {
              e.preventDefault();
              stripMarker(textNode, lineStart, cursorPos);
              this.insertList('numbered');
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
              
              // Find the nearest block-level ancestor of textNode that's a
              // direct child of the editor — that's where we insert the task.
              let insertPoint = textNode;
              while (insertPoint.parentNode && insertPoint.parentNode !== this.editor) {
                insertPoint = insertPoint.parentNode;
              }
              if (insertPoint.parentNode === this.editor) {
                insertPoint.parentNode.insertBefore(container, insertPoint);

                setTimeout(() => {
                  label.focus();
                  const newRange = document.createRange();
                  const labelText = label.firstChild;
                  if (labelText) {
                    newRange.setStart(labelText, 0);
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
            
            // > → blockquote
            const blockquoteMatch = lineText.match(/^>$/);
            if (blockquoteMatch) {
              e.preventDefault();
              stripMarker(textNode, lineStart, cursorPos);
              this.insertBlockquote();
              return;
            }
            
            // --- → horizontal rule
            const hrMatch = lineText.match(/^---$/);
            if (hrMatch) {
              e.preventDefault();
              const beforeText = text.substring(0, lineStart);
              const afterText = text.substring(cursorPos);
              textNode.textContent = beforeText + afterText;

              // Walk up to the closest direct child of the editor as the insertion anchor.
              let insertPoint = textNode;
              while (insertPoint.parentNode && insertPoint.parentNode !== this.editor) {
                insertPoint = insertPoint.parentNode;
              }
              if (insertPoint.parentNode === this.editor) {
                const hr = document.createElement('hr');
                insertPoint.parentNode.insertBefore(hr, insertPoint);

                const br = document.createElement('br');
                hr.parentNode.insertBefore(br, hr.nextSibling);

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
          
          // Find the enclosing task-label (cursor may be inside a nested
          // formatting tag like <strong> within the label).
          const taskLabel = node && node.closest ? node.closest('.task-label') : null;
          if (taskLabel) {
            // Empty task → exit the task list and drop a new line in its place.
            // textContent of a fresh label is just a ZWSP, which trims to ''.
            if (!taskLabel.textContent.replace(/​/g, '').trim()) {
              e.preventDefault();
              const taskItem = taskLabel.parentNode;
              const parent = taskItem && taskItem.parentNode;
              if (!parent) return;

              // Capture position BEFORE removing — nextSibling/parentNode of a
              // detached node are both null, which is the bug we used to hit.
              const anchor = taskItem.nextSibling;
              parent.removeChild(taskItem);

              const br = document.createElement('br');
              if (anchor) {
                parent.insertBefore(br, anchor);
              } else {
                parent.appendChild(br);
              }

              const newRange = document.createRange();
              newRange.setStartAfter(br);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);

              this.saveState();
              if (this.onChange) this.onChange();
              return;
            }

            // Non-empty task → create a new task below.
            e.preventDefault();

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
            newLabel.innerHTML = '&#8203;';

            newContainer.appendChild(newCheckbox);
            newContainer.appendChild(newLabel);

            const currentTask = taskLabel.parentNode;
            if (currentTask && currentTask.parentNode) {
              currentTask.parentNode.insertBefore(newContainer, currentTask.nextSibling);

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
            return;
          }
        }
      }

      // Backspace at the start of a task-label → remove the whole task item.
      // Gives users an obvious way to delete an unwanted checkbox.
      if (e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const startContainer = range.startContainer;
          const taskLabel = (startContainer.nodeType === Node.ELEMENT_NODE
            ? startContainer
            : startContainer.parentElement)?.closest('.task-label');

          if (taskLabel && range.collapsed) {
            // "At the start" — accounting for a possible leading ZWSP.
            const text = taskLabel.textContent || '';
            const leadingZwsp = text.startsWith('​') ? 1 : 0;
            const atStart = (startContainer === taskLabel && range.startOffset <= leadingZwsp)
              || (startContainer.nodeType === Node.TEXT_NODE
                  && startContainer === taskLabel.firstChild
                  && range.startOffset <= leadingZwsp);

            if (atStart) {
              e.preventDefault();
              const taskItem = taskLabel.parentNode;
              const parent = taskItem && taskItem.parentNode;
              if (!parent) return;

              // Capture neighbors BEFORE removing — detached nodes have null siblings.
              const prev = taskItem.previousSibling;
              const next = taskItem.nextSibling;
              parent.removeChild(taskItem);

              this.editor.focus();
              const newRange = document.createRange();

              if (prev) {
                // Land cursor at the end of the previous task's label, or right
                // after the previous block.
                const prevLabel = prev.nodeType === Node.ELEMENT_NODE
                  ? prev.querySelector?.('.task-label')
                  : null;
                if (prevLabel) {
                  prevLabel.focus();
                  newRange.selectNodeContents(prevLabel);
                  newRange.collapse(false);
                } else {
                  newRange.setStartAfter(prev);
                  newRange.collapse(true);
                }
              } else if (next) {
                // No previous: land at the start of whatever's next.
                newRange.setStartBefore(next);
                newRange.collapse(true);
              } else {
                // Editor is now empty — without an anchor element the caret
                // (and the placeholder pseudo-element) won't render. Insert a
                // <br> so contenteditable has a paint target.
                const br = document.createElement('br');
                this.editor.appendChild(br);
                newRange.setStartBefore(br);
                newRange.collapse(true);
              }

              selection.removeAllRanges();
              selection.addRange(newRange);

              this.saveState();
              if (this.onChange) this.onChange();
              return;
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
    // Delegate to formatBlock — handles cursor-on-line, selections, and nested
    // parents correctly. Used to produce a "Heading" placeholder for the
    // cursor-on-line case when text was a direct child of #editor.
    this.editor.focus();
    document.execCommand('formatBlock', false, `H${level}`);
    this.saveState();
    if (this.onChange) {
      this.onChange();
    }
  }

  insertList(type) {
    // Delegate to the browser's built-in list command. It correctly handles:
    //  - cursor on a line of plain text → wraps that whole line as <li>
    //  - selection across one or more lines → each line becomes an <li>
    //  - cursor already inside a list of this type → toggles the list off
    //  - cursor inside nested elements (<p>, <div>, etc.) → still works
    // The manual implementation was producing "<ul><li>List item</li></ul>"
    // placeholders for the cursor-on-line case and was splitting partial
    // selections like "Hello" inside "Hello World" into a bullet plus orphan
    // text, which looked like "just creates a new line".
    this.editor.focus();
    const command = type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
    document.execCommand(command, false);
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
    // Same delegation pattern as insertHeading / insertList.
    this.editor.focus();
    document.execCommand('formatBlock', false, 'BLOCKQUOTE');
    this.saveState();
    if (this.onChange) {
      this.onChange();
    }
  }

  // Revert the current block (H1/H2/H3/BLOCKQUOTE/etc.) back to a paragraph.
  // Also lifts the line out of any UL/OL it's in.
  clearBlockFormat() {
    this.editor.focus();
    // First, exit any list the cursor is in by toggling it off.
    const sel = window.getSelection();
    if (sel.rangeCount) {
      let node = sel.getRangeAt(0).startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const inList = node && node.closest && node.closest('ul, ol');
      if (inList) {
        const cmd = inList.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList';
        document.execCommand(cmd, false);
      }
    }
    // Then format the block as a plain paragraph.
    document.execCommand('formatBlock', false, 'P');
    this.saveState();
    if (this.onChange) this.onChange();
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

  // Find-in-note: walks text nodes inside the editor and wraps matches with
  // <span class="find-match">. Returns the number of matches found. The active
  // match (highlighted differently) is tracked via `activeMatchIndex`.
  findInNote(query) {
    this.clearFindHighlights();
    if (!query) {
      this.activeMatchIndex = -1;
      return 0;
    }

    const matcher = query.toLowerCase();
    const walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip text inside an existing .find-match — there shouldn't be any
        // after clearFindHighlights, but be defensive.
        if (node.parentElement && node.parentElement.classList?.contains('find-match')) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue && node.nodeValue.toLowerCase().includes(matcher)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      const lower = text.toLowerCase();
      const frag = document.createDocumentFragment();
      let cursor = 0;
      let idx;
      while ((idx = lower.indexOf(matcher, cursor)) !== -1) {
        if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
        const span = document.createElement('span');
        span.className = 'find-match';
        span.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(span);
        cursor = idx + query.length;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      textNode.parentNode.replaceChild(frag, textNode);
    }

    const matches = this.editor.querySelectorAll('.find-match');
    this.activeMatchIndex = matches.length > 0 ? 0 : -1;
    this._setActiveMatch();
    return matches.length;
  }

  nextMatch() {
    const matches = this.editor.querySelectorAll('.find-match');
    if (!matches.length) return;
    this.activeMatchIndex = (this.activeMatchIndex + 1) % matches.length;
    this._setActiveMatch();
  }

  prevMatch() {
    const matches = this.editor.querySelectorAll('.find-match');
    if (!matches.length) return;
    this.activeMatchIndex = (this.activeMatchIndex - 1 + matches.length) % matches.length;
    this._setActiveMatch();
  }

  _setActiveMatch() {
    const matches = this.editor.querySelectorAll('.find-match');
    matches.forEach((m, i) => {
      m.classList.toggle('active', i === this.activeMatchIndex);
    });
    if (this.activeMatchIndex >= 0 && matches[this.activeMatchIndex]) {
      matches[this.activeMatchIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // Remove our wrappers without touching the user's own <mark> tags.
  clearFindHighlights() {
    const spans = this.editor.querySelectorAll('.find-match');
    spans.forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
    this.activeMatchIndex = -1;
  }

  // Sanitize pasted HTML. Allowlist is intentionally narrow: text formatting
  // tags, lists, headings, links, code. Everything else (scripts, iframes,
  // images, styles, classes, event handlers) gets stripped. Only http(s)/mailto
  // links survive — javascript: and data: are dropped.
  static sanitizePastedHtml(html) {
    const ALLOWED_TAGS = new Set([
      'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
      'CODE', 'PRE', 'KBD', 'MARK',
      'A',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'UL', 'OL', 'LI',
      'P', 'BR', 'BLOCKQUOTE', 'HR',
      'SPAN', 'DIV'
    ]);
    const SAFE_LINK = /^(https?:|mailto:)/i;

    const doc = new DOMParser().parseFromString(html, 'text/html');

    const walk = (node) => {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (!ALLOWED_TAGS.has(tag)) {
            // Replace disallowed element with its text content so we don't
            // silently lose words.
            const text = document.createTextNode(child.textContent || '');
            node.replaceChild(text, child);
            continue;
          }
          // Strip all attributes except href on <a>
          for (const attr of Array.from(child.attributes)) {
            if (tag === 'A' && attr.name === 'href' && SAFE_LINK.test(attr.value)) continue;
            child.removeAttribute(attr.name);
          }
          // Drop empty <a> with no href
          if (tag === 'A' && !child.getAttribute('href')) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            continue;
          }
          walk(child);
        }
      }
    };

    walk(doc.body);
    return doc.body.innerHTML;
  }
}

module.exports = Editor;
