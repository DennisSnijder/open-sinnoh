/**
 * The map-name popup (decomp overlay 5 map_name_popup.c, at the 30 Hz field tick). The signboard is a BG
 * scrolled up by `offset` DS px: it slides in 4 px a tick from 38 (hidden) to 0, holds 60 ticks, then
 * slides out 4 px a tick. A new name while it shows (crossing back and forth) slides the board out from
 * where it is and back in with the new name; one asked for while sliding out only replaces the name
 * that follows. Hiding is instant (an event or an A press, decomp HandleFieldInput).
 */
import type { MapPopup, MapPopupView, Zone } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

export const MAP_POPUP_HIDDEN = 38;
export const MAP_POPUP_SLIDE = 4;
export const MAP_POPUP_HOLD = 60;

type Board = { name: string; window: Id };

export class MapPopupState {
  private board: Board | null = null;
  private next: Board | null = null;
  private phase: MapPopupView['phase'] = 'in';
  private offset = MAP_POPUP_HIDDEN;
  private timer = 0;

  /** Decomp MapNamePopUp_Show. */
  show(name: string, window: Id): void {
    if (!this.board) {
      this.board = { name, window };
      this.phase = 'in';
      this.offset = MAP_POPUP_HIDDEN;
      return;
    }
    if (this.phase !== 'out') {
      this.phase = 'out';
      this.timer = 0;
    }
    this.next = { name, window };
  }

  /** Decomp MapNamePopUp_Hide. */
  hide(): void {
    this.board = null;
    this.next = null;
  }

  /** One tick of the popup task (SysTask_MapNamePopUpWindow). */
  step(): void {
    if (!this.board) return;
    switch (this.phase) {
      case 'in':
        this.offset = Math.max(0, this.offset - MAP_POPUP_SLIDE);
        if (this.offset === 0) {
          this.timer = 0;
          this.phase = 'hold';
        }
        return;
      case 'hold':
        if (++this.timer >= MAP_POPUP_HOLD) {
          this.timer = 0;
          this.phase = 'out';
        }
        return;
      case 'out':
        this.offset = Math.min(MAP_POPUP_HIDDEN, this.offset + MAP_POPUP_SLIDE);
        if (this.offset < MAP_POPUP_HIDDEN) return;
        if (!this.next) return this.hide();
        this.board = this.next;
        this.next = null;
        this.phase = 'in';
        return;
    }
  }

  view(): MapPopupView | null {
    return this.board && { ...this.board, offset: this.offset, phase: this.phase };
  }

  /** A zone crossing (decomp FieldMap_ChangeZone): shows the new zone's name when its label differs. */
  crossed(from: Zone, to: Zone): void {
    if (to.mapPopup && from.mapPopup?.label !== to.mapPopup.label) this.show(to.name, to.mapPopup.window);
  }

  /** A map load: a warp, a new game or a loaded save (decomp FieldSystem_RequestLocationName). */
  arrived(zone: Zone): void {
    this.hide();
    const p: MapPopup | undefined = zone.mapPopup;
    if (p?.onWarp) this.show(zone.name, p.window);
  }
}
