~/countries_of_the_world is a old version of a countries of the world game I have been working on. I want to make a new version that borrows the best features from it and improves.

Explore it namely the md doc to take insparation from the best features, but I think we want to mostly start over use the color scheme in it.

We will start only with a point and type mode. THis time howver the countries will be on a globe that the user can pan around (note we need to think about how this panning works s.t. it runs quickly you can zoom in enough to see very small countries, zoom out not too far can't flip it upside down and it needs to feel snappy run effeciently etc etc.)


Coutries are either:
Unselectable i.e if you select jsut the africa contenet other countries will be dark greyed out.
Uncomplete (unselected) i.e simply white unselected, might be selected at some point
Uncomplete (selected) blue the user can attempt the name. If done correctly the flag and name pop up at the top briefly.
Complete green
Complete selected in this state the name and the map appear, the user can recick on already completed countries to check there name / flag.

Panning:

if you click on a country it will pan to the center.

You can click skip button (or press tab to skip) or if you complete a country we autoselect the next in the same way. Here we don't need the ocuntry to be perfectly centered we pan to get it within some excetable view padding window (not sure if this the best way to describe it)

View levels are determined by the countries size same as the old version.

There should be some sort of autoselect inertia, genralyl we select the nearest country but say the user just selected a country typed it then selected a country to the right we protize right (to some extent not jumping accross the ocean.) it should feel somewhat inuitative what country will be selected next.

In the globe version where now we can zoom infinately perhaps consider how teeny coutnries may work perhaps they get a dot but if you zoom sufficently it disapears.

I want you to think deeply about this feeling inutivate natural sensible snappy etc. IT should feel great.

We will think about the other modes later
