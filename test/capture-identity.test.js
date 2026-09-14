import { describe, expect, it } from 'vitest';
import { buildImageItems, mergeCapturedImages } from '../src/platforms/instagram.js';
import { buildCapturedItems, buildImageItems as buildFacebookImages } from '../src/platforms/facebook.js';

const ig = 'https://scontent.cdninstagram.com';
const fb = 'https://scontent.fbcdn.net';
const capture = (url) => ({url, type:'image'});

describe('size-only capture identity and original download URLs', () => {
  it('deduplicates the issue-provided stp sizes and selects the requested Instagram quality', () => {
    const first = `${ig}/photo_n.jpg?stp=dst-jpg_e35_s150x150&oh=signature&oe=expiry`;
    const larger = first.replace('s150x150', 's640x640');
    const {items, considered} = buildImageItems([{src:first}, {src:larger}], 'post');
    expect(items.map((item) => item.url)).toEqual([larger]);
    expect(buildImageItems(
      [{src:larger}, {src:first}],
      'post',
      1,
      {maxWidth:320},
    ).items.map((item) => item.url)).toEqual([first]);
    expect(considered).toBe(2);
  });

  it('keeps non-size transformations, other query fields and different photos distinct', () => {
    const first = `${ig}/photo_n.jpg?stp=dst-jpg_e35_s150x150&oh=signature`;
    const urls = [first, first.replace('e35','e15'), first.replace('signature','different'), first.replace('photo_n','other_n')];
    expect(buildImageItems(urls.map((src) => ({src})), 'post').items).toHaveLength(4);
  });

  it('uses size-normalized keys to reject captures already found in the DOM', () => {
    const url = `${ig}/photo_n.jpg?stp=dst-jpg_e35_s150x150&oh=signature`;
    const result = mergeCapturedImages([{url, type:'image'}], [capture(url.replace('s150x150','s640x640'))], 'post', 2);
    expect(result.items).toEqual([{url, type:'image'}]);
    expect(result.index).toBe(2);
  });

  it('keeps the sharpest captured Instagram URL byte-for-byte, including signed path and query', () => {
    const small = `${ig}/s150x150/photo_n.jpg?stp=dst-jpg_e35_s150x150&oh=A%2FB&oe=123`;
    const large = small.replaceAll('s150x150','s640x640');
    const {items, dropped} = mergeCapturedImages([], [capture(small),capture(large)], 'post');
    expect(items.map((item) => item.url)).toEqual([large]);
    expect(dropped).toBe(0);
  });

  it('compares query-only Instagram widths when selecting among raw captures', () => {
    const small = `${ig}/photo_n.jpg?stp=dst-jpg_e35_s150x150&oh=signature`;
    const large = small.replace('s150x150','s640x640');
    expect(mergeCapturedImages([], [capture(small),capture(large)], 'post').items.map((item) => item.url)).toEqual([large]);
  });

  it('deduplicates id-less Facebook query variants while retaining the raw best capture', () => {
    const small = `${fb}/s150x150/photo_n.jpg?stp=dst-jpg_e35_s150x150&oh=A%2FB&oe=123`;
    const large = small.replaceAll('s150x150','s640x640');
    expect(buildCapturedItems([capture(small),capture(large)]).items.map((item) => item.url)).toEqual([large]);
    const smallDom = small.replace('/s150x150/','/');
    const largeDom = large.replace('/s640x640/','/');
    expect(buildFacebookImages([{src:smallDom},{src:largeDom}]).items.map((item) => item.url)).toEqual([largeDom]);
  });
});

it('ranks p query sizes for both largest and capped Instagram captures', () => {
  const small = `${ig}/photo_n.jpg?stp=dst-jpg_e35_p150x150&oh=signature`;
  const large = small.replace('p150x150', 'p1080x1080');
  expect(mergeCapturedImages([], [capture(small), capture(large)], 'post').items.map((item) => item.url)).toEqual([large]);
  expect(mergeCapturedImages([], [capture(large), capture(small)], 'post', 1, 10, {maxWidth:720}).items.map((item) => item.url)).toEqual([small]);
});
