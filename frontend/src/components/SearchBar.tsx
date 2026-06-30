export function SearchBar() {
  return (
    <section className="tool-panel" aria-labelledby="search-title">
      <div className="panel-heading">
        <p className="eyebrow">Find</p>
        <h2 id="search-title">Search</h2>
      </div>
      <input className="field" disabled placeholder="Search notes..." type="search" />
      <button className="button" disabled type="button">
        Search
      </button>
    </section>
  );
}
