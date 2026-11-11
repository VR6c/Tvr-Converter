'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

export default function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Select…',
  className,
  'aria-label': ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef({ text: '', time: 0 });
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openMenu = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (disabled) return;
    setActiveIndex(index);
    setOpen(true);
  };

  const closeMenu = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const commit = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    if (opt.value !== value) onChange(opt.value);
    closeMenu();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the active option in view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const typeahead = (key: string) => {
    const now = performance.now();
    const ta = typeaheadRef.current;
    ta.text = now - ta.time > 600 ? key : ta.text + key;
    ta.time = now;
    const query = ta.text.toLowerCase();
    const match = options.findIndex((o) => o.label.toLowerCase().startsWith(query));
    if (match < 0) return;
    if (open) setActiveIndex(match);
    else if (options[match].value !== value) onChange(options[match].value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const last = options.length - 1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openMenu();
        else setActiveIndex((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openMenu();
        else setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActiveIndex(last);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) commit(activeIndex);
        else openMenu();
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          closeMenu();
        }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          typeahead(e.key);
        }
    }
  };

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded border border-line bg-surface-sunken px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors',
          'hover:border-line-strong focus-visible:border-brand-400 disabled:opacity-40 disabled:hover:border-line',
          open && 'border-brand-400',
        )}
      >
        <span className={cn('truncate', !selected && 'text-neutral-500')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-neutral-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 origin-top animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-100 max-h-60 min-w-full overflow-y-auto rounded border border-line-strong bg-surface-raised p-1"
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActiveIndex(i)}
                // Keep focus on the trigger so keyboard handling stays in one place
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => commit(i)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-md px-2 py-1.5 text-xs',
                  isSelected ? 'text-brand-300' : 'text-neutral-300',
                  i === activeIndex && 'bg-white/10 text-white',
                )}
              >
                {o.label}
                <Check
                  className={cn(
                    'h-3 w-3 shrink-0 text-brand-400',
                    !isSelected && 'invisible',
                  )}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
