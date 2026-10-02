import { expect } from 'earl'
import { isTooLarge } from './rpc'

describe('isTooLarge', () => {
  it('splits on what providers say about a getLogs response too large', () => {
    for (const message of [
      'Error: eth_getLogs: Response is too big',
      'Error: eth_getLogs: Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range',
      'Error: eth_getLogs: query returned more than 10000 results',
      'Error: eth_getLogs: block range is too large',
      'Error: eth_getLogs: exceed maximum block range: 50000',
    ]) {
      expect(isTooLarge(new Error(message))).toEqual(true)
    }
  })

  it('waits out throttling instead of splitting', () => {
    for (const message of [
      'Error: 429 Too Many Requests',
      'Error: eth_getLogs: rate limit exceeded',
      'Error: eth_getLogs: request throttled',
    ]) {
      expect(isTooLarge(new Error(message))).toEqual(false)
    }
  })
})
