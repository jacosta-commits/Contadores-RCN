// web/supervisor/assets/js/state.js
// Simple Store para Supervisor

class Store {
    constructor() {
        this.telares = {}; // { "0059": { telcod, alias, grupo, ... } }
        this.counters = {}; // { "0059": { hil_act, hil_turno, ... } }
        this.listeners = new Set();
    }

    setTelares(list) {
        list.forEach(t => {
            this.telares[t.telcod] = t;
            // Init counter state if not exists
            if (!this.counters[t.telcod]) {
                this.counters[t.telcod] = {
                    telcod: t.telcod,
                    hil_act: 0,
                    hil_turno: 0,
                    hil_start: 0,
                    set_value: 0,
                    velocidad: 0
                };
            }
        });
        this.notify('telares');
    }

    updateCounter(telcod, payload) {
        if (!this.counters[telcod]) this.counters[telcod] = { telcod };

        // Merge values
        const current = this.counters[telcod];
        Object.assign(current, payload);

        this.notify('counter', telcod);
    }

    subscribe(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    notify(type, detail) {
        this.listeners.forEach(cb => cb(type, detail));
    }
}

export const store = new Store();
