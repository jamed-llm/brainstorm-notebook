# brainstorm-notebook

## aim
build an chrome extension to generate a mind note based on the current claude ui conversation. 

## design

### setting page
when go to the setting of the extension, we should allow the user to set api keys to use. 
user can add multiple keys, name them, and after save the keys should be encrypted.
user can drag and drop the keys to adjust order.
user can check to select which api keys to use. the keys will be used in the order, when the previous key not work, we use the next

### mind note
* when click on the icon, we open a mindnote on the right of the claude conversation page. we can drag to adjust the width.
* we build the mind note as a unilateral connected digraph，as the new node may have multiple parent nodes
    1. nodes are connected by lines, the strength of the lines shows the relationship between the parent and child. strength have three levels, strong / middle / thin
    2. when hover on a node, we highlight the lines connected to it and the parents of it
    3. when click on a node, the claude chat ui should go to that node, and in the mind note, we highlight all the ancestor nodes and lines from root to it
* every time we ask a question and claude finished generating a response, we do the following:
    1. based on the conversation, decide the parent node. 
        * first check if the last pair should be a parent of it. if so, use strong line
        * then check the previous nodes to see if this is related to any of them. 
    2. make the node
        * title: a phrase describing this turn chat
        * one sentence summary: a one sentence summary of this node used to judge the relationship with others
    3. reformat the diagraph
        * for each node, get the longest chain from root to it, this is the level of the node
        * nodes of the same level should be in the same row
        * auto reformat at each response finish, also add a button to reformat