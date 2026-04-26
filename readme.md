# GPX Viewer


## Initial Prompt
make me a website using bun and typescript that take a directory full of GPX and fit.gz files and shows the names based on date.

  this should be pretty simple. dont get too fancy. its just a tool for internal use.

  react may not even be necessary.

  it should show:

```
  [FILENAME] | [Date] | [Activity Type] | [File size]
```

  Acitivty type will come from the gpx/fit.gz file.


  this will be a tool for organzing these files.

  i should be able to filter between a range: start date & end date

  rough design:

```

  Filter: -------------------------------------
  Start: [] (optional) End: [] (Optoinal)    |
  --------------------------------------------


  [FILENAME] | [Date] | [Activity Type] | [File size]
  ---------------------------------------------------
  1289312.gpx | Aug 2, 2025 7:15am - Aug 2, 2025 8:00am | biking | 300Kb
```

  you should use a native file picker for selecting the directory, whatever browser API leads to that.


  V2 stretch goal: show a small map of the activity using leaflet probably
