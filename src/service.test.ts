import {test,expect} from 'bun:test';
import {Service} from './service.ts';
class Capture extends Service { calls:Record<string,unknown>[]=[]; override async execute(_name:string,variables:Record<string,unknown>={}) { this.calls.push(variables); return {}; } }
test('friendly calendar months translate to API zero-based months',async()=>{const service=new Capture();await service.events({month:10,year:2026});expect(service.calls[0]).toMatchObject({month:9,year:2026});await service.events({month:1,year:2026});expect(service.calls[1]).toMatchObject({month:0,year:2026});});
test('default month uses current API month and week queries stay unchanged',async()=>{const service=new Capture();await service.events();expect(service.calls[0]).toMatchObject({month:new Date().getUTCMonth()});await service.events({week:42,year:2026});expect(service.calls[1]).toEqual({week:42,year:2026});});
