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
