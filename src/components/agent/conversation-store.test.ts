import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../builder-conversation-island';

describe('conversation streaming state', () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = () => {
    vi.stubGlobal('window', {requestAnimationFrame: () => 1});
    const store = createStore();
    const id = store.addMessage({role:'assistant', content:''});
    store.startLiveRun(id);
    return {store,id};
  };
  /*
   * The shimmer lives behind `streaming && state.thinking` in `AgentMessage`,
   * and `state` is `liveRun.chat`. `EMPTY_MESSAGE` carries `thinking: false`,
   * so it only lit once the first server envelope arrived — after auth, the
   * project lookup, the harness turn and the intent round, which the run
   * ledger times at four to eight seconds. The user watched an empty bubble
   * for all of it.
   */
  it('is thinking from the moment the run starts, before any server event', () => {
    const {store,id} = setup();
    const chat = store.messages()[0].liveRun?.chat;
    expect(chat?.thinking).toBe(true);
    expect(chat?.status).toBe('streaming');
    expect(store.messages()[0].working).toBe(true);
  });

  /*
   * `setWorking` set a flag and an `activeText` and created no `chat`, so the
   * render fell through to `message.content` — empty on a fresh card — and drew
   * nothing. `is-working` on the wrapper carries no styling anywhere, so the
   * flag alone was never going to show.
   */
  it('gives a working message something to draw before the run starts', () => {
    vi.stubGlobal('window', {requestAnimationFrame: () => 1});
    const store = createStore();
    const id = store.addMessage({role:'assistant', content:''});
    store.setWorking(id, 'Coden analyse votre demande…');
    const chat = store.messages()[0].liveRun?.chat;
    expect(chat).toBeTruthy();
    expect(chat?.thinking).toBe(true);
    expect(chat?.activity).toBe('Coden analyse votre demande…');
  });

  /* And the first streamed token puts it away again. */
  it('stops thinking once real text arrives', () => {
    const {store,id} = setup();
    store.applyChatEvent(id,{runId:'run',messageId:id,seq:1,timestamp:1,type:'text_delta',channel:'chat' as const,payload:{type:'text_delta' as const,delta:'Bonjour'}});
    expect(store.messages()[0].liveRun?.chat?.thinking).toBe(false);
  });

  it('renders a final response even when the stream contained no text', () => {
    const {store,id} = setup();
    store.updateMessage(id, 'Réponse finale');
    store.finishLiveRun(id, 'Réponse finale');
    expect(store.messages()[0].liveRun?.chat?.parts).toEqual([{id:'final-text',type:'text',text:'Réponse finale',done:true}]);
    expect(store.messages()[0].liveRun?.chat?.status).toBe('done');
  });
  it('keeps streamed text in the conversation context and resets a retry', () => {
    const {store,id} = setup();
    const event = {runId:'run',messageId:id,seq:1,timestamp:1,type:'text_delta',channel:'chat' as const,payload:{type:'text_delta' as const,delta:'Bonjour'}};
    store.applyChatEvent(id,event);
    expect(store.messages()[0].content).toBe('Bonjour');
    store.finishLiveRun(id);
    store.startLiveRun(id);
    store.applyChatEvent(id,{...event,payload:{type:'text_delta',delta:'Nouvelle réponse'}});
    expect(store.messages()[0].content).toBe('Nouvelle réponse');
  });
});
