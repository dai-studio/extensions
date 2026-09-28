declare module 'saxen' {
  export class Parser {
    constructor(options?: { proxy?: boolean });
    on(event: string, cb: (...args: any[]) => void): this;
    ns(map?: Record<string, string>): this;
    parse(xml: string): this;
    stop(): void;
  }
}

declare module 'bpmn-moddle' {
  export interface ModdleElement {
    $type: string;
    $descriptor: {
      propertiesByName: Record<string, { name: string; ns: { prefix: string; localName: string }; isAttr?: boolean; isMany?: boolean; isBody?: boolean }>;
    };
    $attrs: Record<string, string>;
    [key: string]: any;
  }
  export class BpmnModdle {
    constructor(packages?: Record<string, unknown>, options?: Record<string, unknown>);
    create(type: string, attrs?: Record<string, unknown>): ModdleElement;
    fromXML(xml: string, typeName?: string): Promise<{ rootElement: ModdleElement; warnings: Array<{ message: string }>; elementsById: Record<string, ModdleElement> }>;
    toXML(el: ModdleElement, options?: Record<string, unknown>): Promise<{ xml: string }>;
    getType(name: string): unknown;
  }
}
