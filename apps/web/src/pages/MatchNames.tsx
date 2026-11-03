import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MatchSnapshot } from '@pickle/shared';
import { Button, Modal } from '../ui';
import { patch } from '../lib/api';
import { toast, toastError } from '../lib/toast';
import { NamesFields, draftFromMatch, draftToSlots, type NameDraft } from '../console/Wizard';

/** Admin: edit names / link typed names to registered players on a finished match (FR-PLAYER-11). */
export function EditNamesDialogFinished({ d, onClose }: { d: MatchSnapshot; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<NameDraft>(() => draftFromMatch(d));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await patch(`matches/${d.id}/players`, { teamAName: draft.teamAName, teamBName: draft.teamBName, players: draftToSlots(draft, d.playType) });
      toast('Names saved', 'success'); void qc.invalidateQueries({ queryKey: ['matches'] }); void qc.invalidateQueries({ queryKey: ['players'] }); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} wide title="Edit names / link players" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <NamesFields playType={d.playType} draft={draft} onChange={setDraft} />
    </Modal>
  );
}
