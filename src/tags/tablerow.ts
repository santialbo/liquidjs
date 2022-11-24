import { toEnumerable } from '../util/collection'
import { ValueToken, Liquid, Tag, _evalToken, Emitter, Hash, TagToken, TopLevelToken, Context, Template, ParseStream } from '..'
import { TablerowloopDrop } from '../drop/tablerowloop-drop'
import { Tokenizer } from '../parser/tokenizer'

export default class extends Tag {
  private variable: string
  private hash: Hash
  private templates: Template[]
  private collection: ValueToken
  constructor (tagToken: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(tagToken, remainTokens, liquid)
    const tokenizer = new Tokenizer(tagToken.args, this.liquid.options.operators)

    const variable = tokenizer.readIdentifier()
    tokenizer.skipBlank()

    const predicate = tokenizer.readIdentifier()
    const collectionToken = tokenizer.readValue()
    if (predicate.content !== 'in' || !collectionToken) {
      throw new Error(`illegal tag: ${tagToken.getText()}`)
    }

    this.variable = variable.content
    this.collection = collectionToken
    this.hash = new Hash(tokenizer.remaining())
    this.templates = []

    let p
    const stream: ParseStream = this.liquid.parser.parseStream(remainTokens)
      .on('start', () => (p = this.templates))
      .on('tag:endtablerow', () => stream.stop())
      .on('template', (tpl: Template) => p.push(tpl))
      .on('end', () => {
        throw new Error(`tag ${tagToken.getText()} not closed`)
      })

    stream.start()
  }

  * render (ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    let collection = toEnumerable(yield _evalToken(this.collection, ctx))
    const hash = (yield this.hash.render(ctx)) as Record<string, any>
    const offset = hash.offset || 0
    const limit = (hash.limit === undefined) ? collection.length : hash.limit

    collection = collection.slice(offset, offset + limit)
    const cols = hash.cols || collection.length

    const r = this.liquid.renderer
    const tablerowloop = new TablerowloopDrop(collection.length, cols, this.collection.getText(), this.variable)
    const scope = { tablerowloop }
    ctx.push(scope)

    for (let idx = 0; idx < collection.length; idx++, tablerowloop.next()) {
      scope[this.variable] = collection[idx]
      if (tablerowloop.col0() === 0) {
        if (tablerowloop.row() !== 1) emitter.write('</tr>')
        emitter.write(`<tr class="row${tablerowloop.row()}">`)
      }
      emitter.write(`<td class="col${tablerowloop.col()}">`)
      yield r.renderTemplates(this.templates, ctx, emitter)
      emitter.write('</td>')
    }
    if (collection.length) emitter.write('</tr>')
    ctx.pop()
  }
}
